import { importLegacyPayload } from '../services/legacyMigration.js';

export async function importBrowserState(req,res,next){
  try{
    if(req.user.role!=='Owner')return res.status(403).json({message:'Only the Owner can import browser-stored operational data.'});
    if(!req.body?.data||typeof req.body.data!=='object'||Array.isArray(req.body.data))return res.status(400).json({message:'A restaurant state data object is required.'});
    const result=await importLegacyPayload(req.body.data);
    return res.json({...result,sourceRecords:Object.fromEntries(['tables','menuItems','orders','kots','bills','payments','auditEvents','notifications','waiters'].map(key=>[key,Array.isArray(req.body.data[key])?req.body.data[key].length:0]))});
  }catch(error){next(error);}
}
