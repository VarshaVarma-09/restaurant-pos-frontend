import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import Kot from '../models/Kot.js';
import Order from '../models/Order.js';
import AuditEvent from '../models/AuditEvent.js';
import Notification from '../models/Notification.js';
import { permissions } from '../middleware/auth.js';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const actor=user=>({userId:user.staffProfileId||user.id,name:user.name,role:user.role});
const serialize=doc=>{const data=doc.toObject();delete data._id;delete data.__v;return data;};
export async function listKots(req,res,next){try{const kots=await Kot.find().sort({createdAt:1,sequence:1}).lean();res.json({kots:kots.map(kot=>{delete kot._id;delete kot.__v;if(req.user.role==='Kitchen Staff')kot.items=(kot.items||[]).map(item=>{const sanitized={...item};delete sanitized.unitPrice;delete sanitized.menuItemId;return sanitized;});return kot;})});}catch(error){next(error);}}
export async function updateKotStatus(req,res,next){
  const session=await mongoose.startSession();
  try{
    let result;
    await session.withTransaction(async()=>{
      const kot=await Kot.findOne({id:req.params.id}).session(session);
      if(!kot)throw fail('KOT not found.',404);
      const order=await Order.findOne({id:kot.orderId}).session(session);
      if(!order||!['Open','In Progress'].includes(order.status))throw fail('KOTs can only change while their order is active.',409);
      if(req.user.role==='Waiter'&&order.assignedWaiter?.userId!==actor(req.user).userId)throw fail('Waiters may serve only KOTs assigned to them.',403);
      const transitions={Queued:['Preparing','Cancelled'],Preparing:['Ready','Cancelled'],Ready:['Served','Cancelled'],Served:[],Cancelled:[],Closed:[]};
      const next=req.body.status;
      if(!transitions[kot.status]?.includes(next))throw fail(`Invalid KOT transition from ${kot.status}.`,409);
      if(next==='Cancelled'&&!permissions[req.user.role]?.includes('kitchen:cancel'))throw fail('KOT cancellation is not allowed for your role.',403);
      if(next==='Served'&&!permissions[req.user.role]?.includes('kitchen:serve'))throw fail('Serving KOTs is not allowed for your role.',403);
      if(['Preparing','Ready'].includes(next)&&!permissions[req.user.role]?.includes('kitchen:update'))throw fail('Kitchen update permission is required.',403);
      const previous=kot.status;kot.status=next;
      if(next==='Cancelled'){const reason=String(req.body.reason||'').trim();if(!reason)throw fail('A cancellation reason is required.');kot.cancellationReason=reason.slice(0,300);kot.cancelledBy=actor(req.user);kot.cancelledAt=new Date();}
      if(next==='Served'){kot.servedAt=new Date();kot.servedBy=actor(req.user);}
      await kot.save({session});
      if(next==='Preparing'&&order.status==='Open'){order.status='In Progress';await order.save({session});}
      await AuditEvent.create([{id:randomUUID(),orderId:order.id,kotId:kot.id,action:next==='Served'?'kot_served':'kot_status_changed',reason:String(req.body.reason||`KOT moved to ${next}`),previousStatus:previous,newStatus:next,actor:actor(req.user)}],{session});
      if(next==='Ready'){
        const note={id:randomUUID(),orderId:order.id,kotId:kot.id,recipientUserId:order.assignedWaiter?.userId||null,recipientName:order.assignedWaiter?.name||null,orderNumber:order.orderNumber,kotSequence:kot.sequence,orderType:order.orderType,tableId:order.tableId,title:`KOT #${kot.sequence} ready`,message:`Order #${order.orderNumber}`,type:order.assignedWaiter?'kot_ready':'unassigned_kot_ready',items:kot.items.map(item=>({name:item.name,quantity:item.quantity-(item.cancelledQuantity||0),notes:item.notes||''})).filter(item=>item.quantity>0),createdAt:new Date()};
        await Notification.findOneAndUpdate({kotId:kot.id},{$set:note},{upsert:true,new:true,session});
      }
      if(['Served','Cancelled'].includes(next))await Notification.updateMany({kotId:kot.id,resolvedAt:null},{$set:{resolvedAt:new Date(),resolutionReason:next==='Served'?'KOT served':'KOT cancelled'}},{session});
      result=serialize(kot);
    },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
    res.json({kot:result});
  }catch(error){next(error);}finally{await session.endSession();}
}
