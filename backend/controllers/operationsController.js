import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import Order from '../models/Order.js';
import Kot from '../models/Kot.js';
import Bill from '../models/Bill.js';
import Payment from '../models/Payment.js';
import StaffProfile from '../models/StaffProfile.js';
import Notification from '../models/Notification.js';
import AuditEvent from '../models/AuditEvent.js';
import { permissions } from '../middleware/auth.js';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const actor=user=>({userId:user.staffProfileId||user.id,name:user.name,role:user.role});
const plain=doc=>{const value=doc.toObject();delete value._id;delete value.__v;return value;};
const round=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;

export async function assignWaiter(req,res,next){
  const session=await mongoose.startSession();
  try{let result;await session.withTransaction(async()=>{
    const order=await Order.findOne({id:req.params.id}).session(session);if(!order)throw fail('Order not found.',404);
    if(!['Open','In Progress'].includes(order.status))throw fail('Waiters can only be assigned to active orders.',409);
    let profile=null;if(req.body.waiterId){profile=await StaffProfile.findOne({id:String(req.body.waiterId),active:true}).session(session);if(!profile)throw fail('Active Waiter account not found.',404);}
    const previous=order.assignedWaiter;order.assignedWaiter=profile?{userId:profile.id,name:profile.name,username:profile.username}:null;order.assignmentStatus=profile?'Assigned':'Unassigned';await order.save({session});
    await Notification.updateMany({orderId:order.id,readAt:null,resolvedAt:null},{$set:profile?{recipientUserId:profile.id,recipientName:profile.name,type:'kot_ready'}:{recipientUserId:null,recipientName:null,type:'unassigned_kot_ready'}},{session});
    await AuditEvent.create([{id:randomUUID(),orderId:order.id,action:'waiter_assignment_changed',reason:profile?`Assigned to ${profile.name}`:'Waiter assignment removed',details:{previousWaiterId:previous?.userId||null,waiterId:profile?.id||null},actor:actor(req.user)}],{session});result=plain(order);
  },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});res.json({order:result});}catch(e){next(e);}finally{await session.endSession();}
}

export async function markNotificationRead(req,res,next){try{
  const note=await Notification.findOne({id:req.params.id});if(!note)throw fail('Notification not found.',404);
  if(permissions[req.user.role]?.includes('notifications:own')&&!permissions[req.user.role]?.includes('notifications:manage')&&note.recipientUserId!==(req.user.staffProfileId||req.user.id))throw fail('You can only update your own notifications.',403);
  note.readAt=note.readAt||new Date();await note.save();res.json({notification:plain(note)});
}catch(e){next(e);}}

export async function cancelKotItem(req,res,next){
  const session=await mongoose.startSession();
  try{let result;await session.withTransaction(async()=>{
    const kot=await Kot.findOne({id:req.params.kotId}).session(session);if(!kot)throw fail('KOT not found.',404);
    const order=await Order.findOne({id:kot.orderId}).session(session);if(!order||!['Open','In Progress'].includes(order.status))throw fail('Items can only be cancelled on an active order.',409);
    if(['Served','Cancelled','Closed'].includes(kot.status))throw fail('Items on a served or closed KOT cannot be cancelled.',409);
    const bill=await Bill.findOne({orderId:order.id,status:'Open'}).session(session);if(!bill)throw fail('An open bill is required to cancel KOT items.',409);
    const item=kot.items.find(line=>line.lineId===req.params.lineId);if(!item)throw fail('KOT item not found.',404);
    const quantity=Number(req.body.quantity),remaining=item.quantity-(item.cancelledQuantity||0),reason=String(req.body.reason||'').trim();
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>remaining)throw fail(`Cancellation quantity must be from 1 to ${remaining}.`);
    if(!reason)throw fail('A cancellation reason is required.');
    const timestamp=new Date();item.cancelledQuantity+=quantity;item.cancellations.push({id:randomUUID(),quantity,reason:reason.slice(0,300),actor:actor(req.user),timestamp});
    const allCancelled=kot.items.every(line=>line.quantity<=line.cancelledQuantity);
    if(allCancelled){kot.status='Cancelled';kot.cancellationReason='All KOT item quantities cancelled';kot.cancelledBy=actor(req.user);kot.cancelledAt=timestamp;}
    await kot.save({session});
    const allKots=await Kot.find({orderId:order.id,status:{$ne:'Cancelled'}}).session(session);
    const billItems=allKots.flatMap(ticket=>ticket.items.map(line=>({lineId:line.lineId,menuItemId:line.menuItemId,name:line.name,unitPrice:line.unitPrice,quantity:Math.max(0,line.quantity-(line.cancelledQuantity||0)),notes:line.notes||'',category:line.category||''})).filter(line=>line.quantity>0));
    const subtotal=round(billItems.reduce((sum,line)=>sum+line.unitPrice*line.quantity,0));
    if(bill.discount>subtotal)throw fail('Cancellation would make the bill discount exceed its subtotal.',409);
    const taxAmount=round((subtotal-bill.discount)*bill.taxRate),grandTotal=Math.max(0,round(subtotal-bill.discount+taxAmount));
    const paid=await Payment.aggregate([{$match:{billId:bill.id,status:'Completed'}},{$group:{_id:null,total:{$sum:'$amountAppliedMinor'}}}]).session(session);
    if((paid[0]?.total||0)>Math.round(grandTotal*100))throw fail('Cancellation would reduce the bill below completed payments.',409);
    bill.items=billItems;bill.subtotal=subtotal;bill.taxAmount=taxAmount;bill.grandTotal=grandTotal;
    if(grandTotal===0&&(paid[0]?.total||0)===0){bill.status='Settled';bill.settlementType='ZeroBalance';bill.settledAt=timestamp;bill.settledBy=actor(req.user);}
    await bill.save({session});
    const paidMinor=paid[0]?.total||0;order.paymentStatus=paidMinor<=0?(grandTotal===0?'Paid':'Unpaid'):(paidMinor>=Math.round(grandTotal*100)?'Paid':'Partially Paid');await order.save({session});
    if(allCancelled)await Notification.updateMany({kotId:kot.id,resolvedAt:null},{$set:{resolvedAt:timestamp,resolutionReason:reason}},{session});
    else if(kot.status==='Ready')await Notification.updateOne({kotId:kot.id,resolvedAt:null},{$set:{items:kot.items.map(line=>({name:line.name,quantity:line.quantity-line.cancelledQuantity,notes:line.notes||''})).filter(line=>line.quantity>0)}},{session});
    await AuditEvent.create([{id:randomUUID(),orderId:order.id,kotId:kot.id,action:'kot_item_cancelled',reason,previousStatus:kot.status,newStatus:kot.status,details:{lineId:item.lineId,quantity},actor:actor(req.user)}],{session});
    result={kot:plain(kot),bill:plain(bill)};
  },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});res.json(result);}catch(e){next(e);}finally{await session.endSession();}
}
