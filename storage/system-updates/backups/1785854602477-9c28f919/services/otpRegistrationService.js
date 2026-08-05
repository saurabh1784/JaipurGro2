const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const User = require('../models/User');
const Profile = require('../models/Profile');
const Wallet = require('../models/Wallet');
const DeliveryPerson = require('../models/DeliveryPerson');

async function ensureTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS otp_registrations (
    id SERIAL PRIMARY KEY, phone VARCHAR(30) NOT NULL, app_type VARCHAR(20) NOT NULL,
    role VARCHAR(50) NOT NULL, profile_data TEXT NOT NULL, mobile_verified SMALLINT NOT NULL DEFAULT 0,
    profile_completed SMALLINT NOT NULL DEFAULT 1, approval_status VARCHAR(24) NOT NULL DEFAULT 'otp_pending',
    is_active SMALLINT NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(phone, app_type))`);
}

function normalize(appType) {
  const value=String(appType||'client').toLowerCase();
  if(value==='vendor') return {appType:'vendor',role:'Vendor'};
  if(value==='delivery') return {appType:'delivery',role:'deliveryPerson'};
  return {appType:'client',role:'Client'};
}

function validateProfile(profile, appType) {
  const required=appType==='delivery'?['name','email','city','area']:appType==='vendor'?['name','email','city']:['name','email','city','area'];
  const missing=required.filter((key)=>!String(profile?.[key]||'').trim());
  if(missing.length){const error=new Error(`Complete all required fields: ${missing.join(', ')}`);error.status=422;throw error;}
}

async function start({phone,appType,profile}) {
  await ensureTable(); const normalized=normalize(appType); validateProfile(profile,normalized.appType);
  const existing=await User.findByEmailOrPhoneIdentifier(phone);
  if(existing) return {existingUser:true,user:existing};
  const [emailRows]=await pool.query('SELECT id FROM users WHERE LOWER(email)=LOWER(?) AND is_deleted=0 LIMIT 1',[String(profile.email).trim()]);
  if(emailRows.length){const error=new Error('This email is already registered.');error.status=409;throw error;}
  await pool.query(`INSERT INTO otp_registrations (phone,app_type,role,profile_data,mobile_verified,profile_completed,approval_status,is_active)
    VALUES (?,?,?,?,0,1,'otp_pending',0)
    ON CONFLICT (phone,app_type) DO UPDATE SET role=EXCLUDED.role,profile_data=EXCLUDED.profile_data,profile_completed=1,updated_at=CURRENT_TIMESTAMP`,
    [phone,normalized.appType,normalized.role,JSON.stringify(profile)]);
  return {existingUser:false,registration:await find(phone,normalized.appType)};
}

async function find(phone,appType) {
  await ensureTable(); const [rows]=await pool.query('SELECT * FROM otp_registrations WHERE phone=? AND app_type=? LIMIT 1',[phone,normalize(appType).appType]);
  if(!rows.length)return null; const row=rows[0]; row.profile=JSON.parse(row.profile_data||'{}'); delete row.profile_data; return row;
}

async function promote(phone,appType,connection=pool) {
  const registration=await find(phone,appType); if(!registration)return null;
  const p=registration.profile; const random=crypto.randomBytes(32).toString('hex'); const password=await bcrypt.hash(random,10);
  const partner=registration.role==='Vendor'||registration.role==='deliveryPerson';
  const userId=await User.create({name:String(p.name).trim(),email:String(p.email).trim(),phone,password,role:registration.role,status:partner?'pending':'active',city:p.city||null,area:p.area||null},connection);
  await Profile.createEmptyForRole(userId,registration.role,connection);
  if(registration.role==='Vendor') await connection.query('UPDATE vendor_profiles SET city=?,gst_number=? WHERE user_id=?',[p.city||null,p.gstNumber||null,userId]);
  if(registration.role==='deliveryPerson') await DeliveryPerson.upsertProfile(userId,{city:p.city||'',area:p.area||'*',status:'pending',is_available:false},connection);
  await Wallet.ensureForUser(userId,connection);
  await pool.query("UPDATE otp_registrations SET mobile_verified=1,approval_status=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",[partner?'pending':'approved',partner?0:1,registration.id]);
  return User.findById(userId);
}

module.exports={start,find,promote,normalize};
