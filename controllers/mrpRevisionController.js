const pool = require('../db');
const { processUploadedFile } = require('../services/imageProcessingService');
const actor = (req) => req.authUser || req.user || {};
const isAdmin = (u) => ['admin','superadmin'].includes(String(u.role || u.roleName || '').toLowerCase().replace(/[\s_-]+/g,'')) || (u.permissions || []).includes('products.manage');

async function list(req, res) {
  const user = actor(req); const admin = isAdmin(user); const params = [];
  let where = '';
  if (!admin) { where = 'WHERE r.vendor_id = ?'; params.push(user.id); }
  else if (req.query.status) { where = 'WHERE r.status = ?'; params.push(req.query.status); }
  const [rows] = await pool.query(`SELECT r.*, p.name product_name, pv.variant_name, u.name vendor_name FROM mrp_revision_requests r JOIN products p ON p.id=r.product_id LEFT JOIN product_variants pv ON pv.id=r.product_variant_id LEFT JOIN users u ON u.id=r.vendor_id ${where} ORDER BY r.created_at DESC`, params);
  res.json({ success: true, requests: rows });
}

async function create(req, res) {
  const user = actor(req); const productId = Number(req.body.product_id); const variantId = req.body.product_variant_id ? Number(req.body.product_variant_id) : null;
  const proposed = Number(req.body.proposed_mrp); const reason = String(req.body.reason || '').trim();
  if (!productId || !Number.isFinite(proposed) || proposed <= 0 || !reason) return res.status(422).json({ success:false, message:'Product, proposed MRP, and reason are required.' });
  const [products] = await pool.query(`SELECT p.price, pv.mrp variant_mrp FROM products p LEFT JOIN product_variants pv ON pv.id=? AND pv.product_id=p.id WHERE p.id=? AND p.is_deleted=0 LIMIT 1`, [variantId, productId]);
  if (!products.length) return res.status(404).json({ success:false, message:'Product not found.' });
  const current = Number(products[0].variant_mrp ?? products[0].price ?? 0);
  const proof = req.file ? await processUploadedFile(req.file, 'product', `mrp-proof-${productId}-${user.id}`) : null;
  try {
    const [result] = await pool.query(`INSERT INTO mrp_revision_requests (vendor_id,product_id,product_variant_id,current_mrp,proposed_mrp,reason,proof_image_url) VALUES (?,?,?,?,?,?,?)`, [user.id,productId,variantId,current,proposed,reason,proof]);
    res.status(201).json({ success:true, message:'MRP revision request submitted for admin review.', id:result.insertId });
  } catch (error) {
    if (String(error.message).toLowerCase().includes('unique')) return res.status(409).json({ success:false, message:'A pending MRP revision already exists for this product.' });
    throw error;
  }
}

async function review(req, res) {
  const user=actor(req); if (!isAdmin(user)) return res.status(403).json({success:false,message:'Admin access required.'});
  const status=String(req.body.status||'').toLowerCase(); const reason=String(req.body.admin_reason||'').trim()||null;
  if (!['approved','rejected'].includes(status)) return res.status(422).json({success:false,message:'Status must be approved or rejected.'});
  if (status==='rejected' && !reason) return res.status(422).json({success:false,message:'A rejection reason is required.'});
  const db=await pool.getConnection();
  try {
    await db.beginTransaction(); const [rows]=await db.query('SELECT * FROM mrp_revision_requests WHERE id=? FOR UPDATE',[req.params.id]); const item=rows[0];
    if (!item) { await db.rollback(); return res.status(404).json({success:false,message:'Request not found.'}); }
    if (item.status!=='pending') { await db.rollback(); return res.status(409).json({success:false,message:'Request already reviewed.'}); }
    if (status==='approved') {
      await db.query('UPDATE products SET price=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[item.proposed_mrp,item.product_id]);
      const suffix=item.product_variant_id?'product_variant_id=?':'product_id=?'; const key=item.product_variant_id||item.product_id;
      await db.query(`UPDATE product_variants SET mrp=?,updated_at=CURRENT_TIMESTAMP WHERE ${item.product_variant_id?'id=?':'product_id=?'}`,[item.proposed_mrp,key]);
      await db.query(`UPDATE vendor_product_variants SET mrp=?,updated_at=CURRENT_TIMESTAMP WHERE ${suffix}`,[item.proposed_mrp,key]);
    }
    await db.query(`UPDATE mrp_revision_requests SET status=?,admin_reason=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`,[status,reason,user.id,item.id]);
    await db.commit(); res.json({success:true,message:`MRP revision ${status}.`});
  } catch(e) { await db.rollback(); throw e; } finally { db.release(); }
}
module.exports={list,create,review};
