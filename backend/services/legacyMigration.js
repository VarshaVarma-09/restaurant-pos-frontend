import mongoose from 'mongoose';
import RestaurantState from '../models/RestaurantState.js';
import Table from '../models/Table.js';
import MenuItem from '../models/MenuItem.js';
import Order from '../models/Order.js';
import Kot from '../models/Kot.js';
import Bill from '../models/Bill.js';
import Payment from '../models/Payment.js';
import AuditEvent from '../models/AuditEvent.js';
import Notification from '../models/Notification.js';
import RestaurantSettings from '../models/RestaurantSettings.js';
import StaffProfile from '../models/StaffProfile.js';

const cleanLine = (line,index,prefix)=>({...line,lineId:String(line.lineId||`${prefix}_${index}`),unitPrice:Number(line.unitPrice??line.price??0),quantity:Math.max(1,Number(line.quantity)||1)});
export async function copyLegacyPayload(data,session){
  const counts={};
  const bulk=async(Model,source,adapt=x=>x)=>{
    if(!Array.isArray(source)||!source.length){counts[Model.collection.collectionName]=0;return;}
    if(source.some(record=>!record||typeof record!=='object'||Array.isArray(record)||record.id==null))throw Object.assign(new Error('Legacy '+Model.collection.collectionName+' data contains a record without a stable id.'),{status:400});
    const records=await Promise.all(source.map(async original=>{const record=adapt(original);delete record._id;delete record.__v;const document=new Model({...record,id:String(record.id),seededDefault:false});await document.validate();const validated=document.toObject({versionKey:false,virtuals:false});delete validated._id;if(Model.schema.options.timestamps){validated.createdAt??=new Date();validated.updatedAt??=validated.createdAt;}return{...validated,id:String(validated.id),seededDefault:false};}));
    const ops=records.flatMap(record=>[
      {updateOne:{filter:{id:record.id,seededDefault:true},update:{$set:record}}},
      {updateOne:{filter:{id:record.id},update:{$setOnInsert:record},upsert:true}}
    ]);
    if(ops.length)await Model.bulkWrite(ops,{session,ordered:true,timestamps:false});
    const ids=[...new Set(records.map(record=>record.id))];
    const copied=ids.length?await Model.countDocuments({id:{$in:ids}}).session(session):0;
    if(copied!==ids.length)throw Object.assign(new Error('Migration verification failed for '+Model.collection.collectionName+'.'),{status:500});
    counts[Model.collection.collectionName]=copied;
  };
  await bulk(Table,data.tables,x=>({...x,name:String(x.name||x.label||`Table ${x.id}`),capacity:Number(x.capacity)||4}));
  await bulk(MenuItem,data.menuItems,x=>({...x,price:Number(x.price??x.unitPrice),available:x.available!==false}));
  await bulk(Order,data.orders,x=>({...x,orderNumber:String(x.orderNumber||x.id),orderType:x.orderType==='DineIn'?'DineIn':'Takeaway',tableId:x.tableId==null?(x.table==null?null:String(x.table)):String(x.tableId),items:(x.items||[]).map((line,i)=>cleanLine(line,i,String(x.id))),status:['Open','In Progress','Completed','Cancelled'].includes(x.status)?x.status:'Open'}));
  await bulk(Kot,data.kots,x=>({...x,sequence:Number(x.sequence??x.kotNumber)||1,items:(x.items||[]).map((line,i)=>({...cleanLine(line,i,String(x.id)),cancelledQuantity:Number(line.cancelledQuantity)||0,cancellations:Array.isArray(line.cancellations)?line.cancellations:[]}))}));
  await bulk(Bill,data.bills,x=>({...x,items:(x.items||[]).map((line,i)=>cleanLine(line,i,String(x.id))),subtotal:Number(x.subtotal)||0,discount:Number(x.discount)||0,taxRate:Number(x.taxRate??0.18),taxAmount:Number(x.taxAmount)||0,grandTotal:Number(x.grandTotal)||0,status:['Open','Settled','Void'].includes(x.status)?x.status:'Open'}));
  await bulk(Payment,data.payments,x=>({...x,billId:String(x.billId||'legacy'),method:['Cash','UPI','Card'].includes(x.method)?x.method:'Cash',amount:Number(x.amountApplied??x.amount)||0,amountApplied:Number(x.amountApplied??x.amount)||0,amountAppliedMinor:Number(x.amountAppliedMinor??Math.round(Number(x.amountApplied??x.amount)*100))||0,idempotencyKey:String(x.idempotencyKey||x.id),status:['Completed','Pending','Failed','Refunded'].includes(x.status)?x.status:'Completed'}));
  await bulk(AuditEvent,data.auditEvents,x=>({...x,action:String(x.action||'legacy_event')}));
  await bulk(Notification,data.notifications,x=>({...x,kotId:String(x.kotId||x.id),orderId:String(x.orderId||'legacy')}));
  await bulk(StaffProfile,data.waiters,x=>({...x,username:String(x.username||x.id).trim().toLowerCase(),name:String(x.name||x.username||x.id).trim()}));
  if(data.restaurantSettings){
    const current=await RestaurantSettings.findOne({key:'default'}).session(session);
    if(current?.seededDefault)await RestaurantSettings.updateOne({key:'default'},{$set:{...data.restaurantSettings,roundRobinPointer:Number(data.roundRobinPointer)||0,seededDefault:false}},{session});
    else await RestaurantSettings.updateOne({key:'default'},{$setOnInsert:{...data.restaurantSettings,key:'default',roundRobinPointer:Number(data.roundRobinPointer)||0,seededDefault:false}},{upsert:true,session});
  }
  else if(Number.isSafeInteger(data.roundRobinPointer))await RestaurantSettings.updateOne({key:'default'},{$setOnInsert:{roundRobinPointer:data.roundRobinPointer,key:'default'}},{upsert:true,session});
  const settingsCopied=await RestaurantSettings.countDocuments({key:'default'}).session(session);
  if(data.restaurantSettings&&settingsCopied!==1)throw Object.assign(new Error('Migration verification failed for restaurant settings.'),{status:500});
  counts[RestaurantSettings.collection.collectionName]=settingsCopied;
  return counts;
}
export async function importLegacyPayload(data){
  if(!data||typeof data!=='object'||Array.isArray(data))throw Object.assign(new Error('Legacy restaurant data must be an object.'),{status:400});
  const session=await mongoose.startSession();
  try{let counts;await session.withTransaction(async()=>{counts=await copyLegacyPayload(data,session);},{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});return{imported:true,counts};}
  finally{await session.endSession();}
}
export async function migrateLegacyState(){
  const legacy=await RestaurantState.findOne({key:'default'}).lean();
  if(!legacy?.data)return{migrated:false,reason:'No legacy state document.'};
  if(legacy.data.migration?.status==='complete')return{migrated:false,reason:'Already migrated.',counts:legacy.data.migration.counts||{}};
  const session=await mongoose.startSession();
  try{let counts;await session.withTransaction(async()=>{counts=await copyLegacyPayload(legacy.data,session);await RestaurantState.updateOne({key:'default'},{$set:{'data.migration':{status:'complete',migratedAt:new Date(),revision:legacy.revision,counts}}},{session});},{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});return{migrated:true,counts};}
  finally{await session.endSession();}
}
