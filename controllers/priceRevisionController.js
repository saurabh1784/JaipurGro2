const pool = require('../db');
const { processUploadedFile } = require('../services/imageProcessingService');
const actor = (req) => req.authUser || req.user || {};
const normalizedRole = (user) => String(user.role || user.roleName || '').toLowerCase().replace(/[\s_-]+/g, '');
const canReview = (user) => ['admin', 'superadmin', 'staff'].includes(normalizedRole(user)) || (user.permissions || []).includes('products.manage');

async function reviewerCities(user) {
  if (!canReview(user) || ['admin', 'superadmin'].includes(normalizedRole(user))) return null;
  const [rows] = await pool.query('SELECT city, assigned_cities FROM admin_profiles WHERE user_id = ? LIMIT 1', [user.id]);
  const row = rows[0] || {};
  return [row.city, ...String(row.assigned_cities || '').split(',')].map(v => v.trim().toLowerCase()).filter(Boolean);
}

async function list(req, res) {
  const user = actor(req); const params = []; const where = [];
  if (normalizedRole(user) === 'vendor') { where.push('r.vendor_id = ?'); params.push(user.id); }
  else {
    if (!canReview(user)) return res.status(403).json({ success:false, message:'Reviewer access required.' });
    const cities = await reviewerCities(user);
    if (cities && cities.length) { where.push('LOWER(COALESCE(r.vendor_city,\'\')) = ANY(?)'); params.push(cities); }
  }
  if (req.query.status) { where.push('r.status = ?'); params.push(String(req.query.status).toLowerCase()); }
  const [rows] = await pool.query(`SELECT r.*, u.name vendor_name, u.phone vendor_phone, p.name product_name, vp.quantity, vp.status product_status FROM price_revision_requests r JOIN users u ON u.id=r.vendor_id JOIN products p ON p.id=r.product_id JOIN vendor_products vp ON vp.id=r.vendor_product_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.created_at DESC`, params);
  res.json({ success:true, requests:rows });
}

async function create(req, res) {
  const user=actor(req); const vendorProductId=Number(req.body.vendor_product_id); const proposed=Number(req.body.proposed_price); const reason=String(req.body.reason||'').trim();
  if (!vendorProductId || !Number.isFinite(proposed) || proposed < 0 || !reason) return res.status(422).json({success:false,message:'Product, proposed price, and reason are required.'});
  const [rows]=await pool.query(`SELECT vp.id,vp.product_id,vp.price,p.name,vprof.city FROM vendor_products vp JOIN products p ON p.id=vp.product_id LEFT JOIN vendor_profiles vprof ON vprof.user_id=vp.vendor_id WHERE vp.id=? AND vp.vendor_id=? LIMIT 1`,[vendorProductId,user.id]);
  if (!rows.length) return res.status(404).json({success:false,message:'Inventory product not found.'});
  const item=rows[0]; const proof=req.file ? await processUploadedFile(req.file,'product',`price-proof-${vendorProductId}-${user.id}`) : null;
  try {
    const [result]=await pool.query(`INSERT INTO price_revision_requests (vendor_id,vendor_product_id,product_id,vendor_city,current_price,proposed_price,reason,proof_url) VALUES (?,?,?,?,?,?,?,?)`,[user.id,item.id,item.product_id,item.city||null,item.price||0,proposed,reason,proof]);
    res.status(201).json({success:true,message:'Price revision request submitted.',id:result.insertId});
  } catch(error) {
    if(String(error.message).toLowerCase().includes('unique')) return res.status(409).json({success:false,message:'A pending price revision already exists for this product.'});
    throw error;
  }
}

async function review(req,res) {
  const user=actor(req); if(!canReview(user)) return res.status(403).json({success:false,message:'Reviewer access required.'});
  const status=String(req.body.status||'').toLowerCase(); const reviewerReason=String(req.body.reviewer_reason||'').trim()||null;
  if(!['approved','rejected','changes_required'].includes(status)) return res.status(422).json({success:false,message:'Invalid review status.'});
  if(status!=='approved' && !reviewerReason) return res.status(422).json({success:false,message:'Reviewer reason is required.'});
  const db=await pool.getConnection();
  try {
    await db.beginTransaction(); const [rows]=await db.query('SELECT * FROM price_revision_requests WHERE id=? FOR UPDATE',[req.params.id]); const item=rows[0];
    if(!item){await db.rollback();return res.status(404).json({success:false,message:'Request not found.'});}
    const cities=await reviewerCities(user); if(cities && cities.length && !cities.includes(String(item.vendor_city||'').toLowerCase())){await db.rollback();return res.status(403).json({success:false,message:'This vendor is outside your assigned cities.'});}
    if(!['pending','changes_required'].includes(item.status)){await db.rollback();return res.status(409).json({success:false,message:'Request has already been reviewed.'});}
    if(status==='approved') await db.query('UPDATE vendor_products SET price=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND vendor_id=?',[item.proposed_price,item.vendor_product_id,item.vendor_id]);
    await db.query(`UPDATE price_revision_requests SET status=?,reviewer_reason=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`,[status,reviewerReason,user.id,item.id]);
    await db.commit(); res.json({success:true,message:`Price revision ${status}.`});
  } catch(error){await db.rollback();throw error;} finally{db.release();}
}
async function setLowStockLimit(req,res) {
  const user=actor(req); if(!canReview(user)) return res.status(403).json({success:false,message:'Reviewer access required.'});
  const limit=Number(req.body.low_stock_limit);
  if(!Number.isInteger(limit)||limit<0) return res.status(422).json({success:false,message:'Low-stock limit must be a non-negative integer.'});
  const [result]=await pool.query('UPDATE vendor_products SET low_stock_limit=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[limit,req.params.vendorProductId]);
  if(!(result.affectedRows||result.rowCount)) return res.status(404).json({success:false,message:'Vendor product not found.'});
  res.json({success:true,message:'Low-stock limit updated.'});
}
module.exports={list,create,review,setLowStockLimit};

