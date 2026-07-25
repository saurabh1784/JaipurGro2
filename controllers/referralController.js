const pool = require('../db');

// Helper: Ensure referral tables exist with PostgreSQL compatibility
async function initReferralTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral_settings (
        id SERIAL PRIMARY KEY,
        city VARCHAR(100) NOT NULL,
        user_type VARCHAR(50) NOT NULL,
        referral_enabled SMALLINT NOT NULL DEFAULT 1,
        max_referrals INTEGER NOT NULL DEFAULT 0,
        referrer_reward DECIMAL(10,2) NOT NULL DEFAULT 50.00,
        new_user_reward DECIMAL(10,2) NOT NULL DEFAULT 25.00,
        reward_condition VARCHAR(50) NOT NULL DEFAULT 'signup',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uniq_city_user_type UNIQUE (city, user_type)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral_messages (
        id SERIAL PRIMARY KEY,
        category VARCHAR(30) NOT NULL DEFAULT 'referral',
        message_title VARCHAR(150) DEFAULT NULL,
        message_text TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral_logs (
        id SERIAL PRIMARY KEY,
        referrer_user_id INTEGER NOT NULL,
        referred_user_id INTEGER NOT NULL,
        referral_code VARCHAR(50) NOT NULL,
        city VARCHAR(100) DEFAULT NULL,
        user_type VARCHAR(50) DEFAULT NULL,
        referrer_reward_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        new_user_reward_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        status VARCHAR(30) NOT NULL DEFAULT 'pending',
        reward_condition VARCHAR(50) DEFAULT 'signup',
        rewarded_at TIMESTAMP NULL DEFAULT NULL,
        reversed_at TIMESTAMP NULL DEFAULT NULL,
        reversal_reason VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add referral columns to users table if missing
    const [cols] = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'referral_code'`
    );
    if (!cols.length) {
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(50) DEFAULT NULL');
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_user_id INTEGER DEFAULT NULL');
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_code VARCHAR(50) DEFAULT NULL');
      await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users (referral_code)');
    }

    // Seed default messages if empty
    const [msgCount] = await pool.query('SELECT COUNT(*) as cnt FROM referral_messages');
    const msgCnt = Number((msgCount[0] && (msgCount[0].cnt || msgCount[0].count)) || 0);
    if (msgCnt === 0) {
      await pool.query(`
        INSERT INTO referral_messages (category, message_title, message_text, status) VALUES
        ('referral', 'Standard Referral Invite', 'Hey! Use my referral code {REFERRAL_CODE} when joining JaipurGro to get ₹{REWARD_AMOUNT} off your orders! Download here: {APP_LINK}', 'active'),
        ('referral', 'Friendly Share', 'Shopping groceries on JaipurGro is super easy! Join with code {REFERRAL_CODE} and get a welcome reward of ₹{REWARD_AMOUNT}. {APP_LINK}', 'active'),
        ('savings', 'Grocery Savings Share', 'I just saved ₹{SAVING_AMOUNT} on my grocery order with JaipurGro! Sign up using code {REFERRAL_CODE} to get special discounts: {APP_LINK}', 'active')
      `);
    }

    // Seed default global referral settings if empty
    const [setCount] = await pool.query('SELECT COUNT(*) as cnt FROM referral_settings');
    const setCnt = Number((setCount[0] && (setCount[0].cnt || setCount[0].count)) || 0);
    if (setCnt === 0) {
      const userTypes = ['Client', 'Vendor', 'Delivery'];
      for (const ut of userTypes) {
        await pool.query(
          `INSERT INTO referral_settings (city, user_type, referral_enabled, max_referrals, referrer_reward, new_user_reward, reward_condition)
           VALUES (?, ?, 1, 0, 50.00, 25.00, 'signup')
           ON CONFLICT DO NOTHING`,
          ['All', ut]
        );
      }
    }

    // Generate referral code for existing users without code
    const [noCodeUsers] = await pool.query("SELECT id, name FROM users WHERE referral_code IS NULL OR referral_code = ''");
    for (const u of noCodeUsers) {
      const code = generateReferralCodeString(u.name, u.id);
      await pool.query('UPDATE users SET referral_code = ? WHERE id = ?', [code, u.id]);
    }
  } catch (err) {
    console.error('Error initializing referral tables:', err);
  }
}

// Generate unique referral code
function generateReferralCodeString(name, userId) {
  const cleanName = (name || 'JG').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const prefix = cleanName.length >= 3 ? cleanName.substring(0, 3) : (cleanName + 'JG').substring(0, 3);
  const randNum = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}${userId}${randNum}`;
}

// Helper: Ensure user has a referral code
async function ensureUserReferralCode(user) {
  if (!user) return null;
  if (user.referral_code && user.referral_code.trim()) return user.referral_code;
  const [rows] = await pool.query('SELECT referral_code FROM users WHERE id = ?', [user.id]);
  if (rows.length && rows[0].referral_code) return rows[0].referral_code;

  const code = generateReferralCodeString(user.name, user.id);
  await pool.query('UPDATE users SET referral_code = ? WHERE id = ?', [code, user.id]);
  return code;
}

// Helper: Get settings for city & user_type
async function getReferralSettings(city, userType) {
  const normCity = (city || 'All').trim();
  const normType = (userType || 'Client').trim();

  const [rows] = await pool.query(
    `SELECT * FROM referral_settings
     WHERE (LOWER(city) = LOWER(?) OR city = 'All')
       AND (LOWER(user_type) = LOWER(?) OR user_type = 'all')
     ORDER BY CASE WHEN LOWER(city) = LOWER(?) THEN 1 ELSE 2 END LIMIT 1`,
    [normCity, normType, normCity]
  );

  if (rows.length) return rows[0];

  return {
    referral_enabled: 1,
    max_referrals: 0,
    referrer_reward: 50.00,
    new_user_reward: 25.00,
    reward_condition: 'signup',
  };
}

// Admin UI: Render Referral Settings page
const renderReferralSettings = async (req, res) => {
  try {
    await initReferralTables();
    const [settings] = await pool.query('SELECT * FROM referral_settings ORDER BY city ASC, user_type ASC');

    const [citiesRows] = await pool.query("SELECT DISTINCT city FROM users WHERE city IS NOT NULL AND city != ''");
    const citiesList = Array.from(new Set(['All', ...citiesRows.map((c) => c.city)]));

    const sessionUser = (req.session && req.session.user) || req.user || req.authUser;
    const shell = req.shell || { navItems: [] };

    res.render('referral-settings', {
      title: 'Referral Settings - User Management',
      user: sessionUser,
      shell,
      settings,
      citiesList,
      userTypes: ['Client', 'Vendor', 'Delivery'],
      message: req.query.msg || null,
      error: req.query.err || null,
    });
  } catch (err) {
    console.error('Error rendering referral settings:', err);
    res.status(500).send('Error loading referral settings');
  }
};

// Admin UI: Save / Update Referral Settings
const saveReferralSettings = async (req, res) => {
  try {
    const { city, user_type, referral_enabled, max_referrals, referrer_reward, new_user_reward, reward_condition } = req.body;

    const normCity = (city || 'All').trim();
    const normType = (user_type || 'Client').trim();
    const isEnabled = referral_enabled === 'on' || referral_enabled === '1' || referral_enabled === 'true' ? 1 : 0;
    const maxRef = parseInt(max_referrals, 10) || 0;
    const refReward = parseFloat(referrer_reward) || 0.0;
    const newReward = parseFloat(new_user_reward) || 0.0;
    const condition = reward_condition === 'first_order' ? 'first_order' : 'signup';

    await pool.query(
      `INSERT INTO referral_settings (city, user_type, referral_enabled, max_referrals, referrer_reward, new_user_reward, reward_condition)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (city, user_type) DO UPDATE SET
         referral_enabled = EXCLUDED.referral_enabled,
         max_referrals = EXCLUDED.max_referrals,
         referrer_reward = EXCLUDED.referrer_reward,
         new_user_reward = EXCLUDED.new_user_reward,
         reward_condition = EXCLUDED.reward_condition,
         updated_at = CURRENT_TIMESTAMP`,
      [normCity, normType, isEnabled, maxRef, refReward, newReward, condition]
    );

    return res.redirect('/referral-settings?msg=Referral+settings+updated+successfully');
  } catch (err) {
    console.error('Error saving referral settings:', err);
    return res.redirect(`/referral-settings?err=${encodeURIComponent(err.message)}`);
  }
};

// Admin UI: Delete Referral Settings rule
const deleteReferralSettings = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM referral_settings WHERE id = ?', [id]);
    return res.redirect('/referral-settings?msg=Setting+deleted');
  } catch (err) {
    return res.redirect(`/referral-settings?err=${encodeURIComponent(err.message)}`);
  }
};

// Admin UI: Render Share Messages Management page
const renderShareMessages = async (req, res) => {
  try {
    await initReferralTables();
    const category = req.query.category || 'referral';
    const [messages] = await pool.query('SELECT * FROM referral_messages WHERE category = ? ORDER BY id DESC', [category]);

    const sessionUser = (req.session && req.session.user) || req.user || req.authUser;
    const shell = req.shell || { navItems: [] };

    res.render('referral-messages', {
      title: `${category === 'savings' ? 'Savings' : 'Referral'} Share Messages`,
      user: sessionUser,
      shell,
      category,
      messages,
      message: req.query.msg || null,
      error: req.query.err || null,
    });
  } catch (err) {
    console.error('Error rendering share messages:', err);
    res.status(500).send('Error loading share messages');
  }
};

// Admin UI: Save Share Message
const saveShareMessage = async (req, res) => {
  try {
    const { id, category, message_title, message_text, status } = req.body;
    const msgCat = category === 'savings' ? 'savings' : 'referral';
    const msgStatus = status === 'inactive' ? 'inactive' : 'active';

    if (id) {
      await pool.query(
        'UPDATE referral_messages SET message_title = ?, message_text = ?, status = ?, category = ? WHERE id = ?',
        [message_title || '', message_text, msgStatus, msgCat, id]
      );
    } else {
      await pool.query(
        'INSERT INTO referral_messages (category, message_title, message_text, status) VALUES (?, ?, ?, ?)',
        [msgCat, message_title || '', message_text, msgStatus]
      );
    }

    return res.redirect(`/referral-messages?category=${msgCat}&msg=Message+saved+successfully`);
  } catch (err) {
    console.error('Error saving share message:', err);
    return res.redirect(`/referral-messages?category=${req.body.category || 'referral'}&err=${encodeURIComponent(err.message)}`);
  }
};

// Admin UI: Delete Share Message
const deleteShareMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const [msg] = await pool.query('SELECT category FROM referral_messages WHERE id = ?', [id]);
    const cat = msg.length ? msg[0].category : 'referral';
    await pool.query('DELETE FROM referral_messages WHERE id = ?', [id]);
    return res.redirect(`/referral-messages?category=${cat}&msg=Message+deleted`);
  } catch (err) {
    return res.redirect(`/referral-messages?err=${encodeURIComponent(err.message)}`);
  }
};

// Admin UI: Toggle Message Status
const toggleShareMessageStatus = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      "UPDATE referral_messages SET status = CASE WHEN status = 'active' THEN 'inactive' ELSE 'active' END WHERE id = ?",
      [id]
    );
    return res.redirect('back');
  } catch (err) {
    return res.redirect('back');
  }
};

// Admin UI: Render Referral Report page
const renderReferralReport = async (req, res) => {
  try {
    await initReferralTables();

    const [logs] = await pool.query(`
      SELECT 
        l.*,
        u1.name as referrer_name, u1.email as referrer_email, u1.role as referrer_role, u1.city as referrer_city,
        u2.name as referred_name, u2.email as referred_email, u2.role as referred_role
      FROM referral_logs l
      LEFT JOIN users u1 ON l.referrer_user_id = u1.id
      LEFT JOIN users u2 ON l.referred_user_id = u2.id
      ORDER BY l.id DESC
    `);

    const [userStats] = await pool.query(`
      SELECT 
        u.id, u.name, u.email, u.role, u.city, u.referral_code,
        COUNT(l.id) as total_referrals,
        SUM(CASE WHEN l.status = 'rewarded' THEN 1 ELSE 0 END) as successful_referrals,
        SUM(CASE WHEN l.status = 'rewarded' THEN l.referrer_reward_amount ELSE 0 END) as total_earnings
      FROM users u
      LEFT JOIN referral_logs l ON u.id = l.referrer_user_id
      WHERE u.referral_code IS NOT NULL
      GROUP BY u.id
      HAVING COUNT(l.id) > 0
      ORDER BY total_earnings DESC, total_referrals DESC
    `);

    const sessionUser = (req.session && req.session.user) || req.user || req.authUser;
    const shell = req.shell || { navItems: [] };

    res.render('referral-report', {
      title: 'Referral Report & Rewards',
      user: sessionUser,
      shell,
      logs,
      userStats,
      message: req.query.msg || null,
      error: req.query.err || null,
    });
  } catch (err) {
    console.error('Error rendering referral report:', err);
    res.status(500).send('Error loading referral report');
  }
};

// Admin Action: Reverse Referral Reward
const reverseReferralReward = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const [logs] = await pool.query('SELECT * FROM referral_logs WHERE id = ?', [id]);
    if (!logs.length) return res.redirect('/referral-report?err=Referral+record+not+found');

    const log = logs[0];
    if (log.status !== 'rewarded') {
      return res.redirect('/referral-report?err=Only+rewarded+referrals+can+be+reversed');
    }

    if (parseFloat(log.referrer_reward_amount) > 0) {
      await deductWalletBalance(
        log.referrer_user_id,
        parseFloat(log.referrer_reward_amount),
        `Referral reward reversal for user #${log.referred_user_id}`
      );
    }

    if (parseFloat(log.new_user_reward_amount) > 0) {
      await deductWalletBalance(
        log.referred_user_id,
        parseFloat(log.new_user_reward_amount),
        'Welcome referral reward reversal'
      );
    }

    await pool.query(
      `UPDATE referral_logs
       SET status = 'reversed', reversed_at = CURRENT_TIMESTAMP, reversal_reason = ?
       WHERE id = ?`,
      [reason || 'Admin reversal', id]
    );

    return res.redirect('/referral-report?msg=Referral+reward+reversed+successfully');
  } catch (err) {
    console.error('Error reversing referral reward:', err);
    return res.redirect(`/referral-report?err=${encodeURIComponent(err.message)}`);
  }
};

// Helper: Deduct amount from user wallet
async function deductWalletBalance(userId, amount, note) {
  const [wallets] = await pool.query('SELECT * FROM wallets WHERE user_id = ?', [userId]);
  if (!wallets.length) return;

  const wallet = wallets[0];
  const currentBal = parseFloat(wallet.balance) || 0.0;
  const newBal = Math.max(0, currentBal - amount);

  await pool.query('UPDATE wallets SET balance = ? WHERE id = ?', [newBal, wallet.id]);
  await pool.query(
    `INSERT INTO wallet_transactions (wallet_id, user_id, type, amount, balance_before, balance_after, reference, note)
     VALUES (?, ?, 'debit', ?, ?, ?, 'referral_reversal', ?)`,
    [wallet.id, userId, amount, currentBal, newBal, note]
  );
}

// Helper: Credit amount to user wallet
async function creditWalletBalance(userId, amount, reference, note) {
  let [wallets] = await pool.query('SELECT * FROM wallets WHERE user_id = ?', [userId]);
  let wallet;
  if (!wallets.length) {
    const [res] = await pool.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0.00)', [userId]);
    wallet = { id: res.insertId, balance: 0.00 };
  } else {
    wallet = wallets[0];
  }

  const currentBal = parseFloat(wallet.balance) || 0.0;
  const newBal = currentBal + amount;

  await pool.query('UPDATE wallets SET balance = ? WHERE id = ?', [newBal, wallet.id]);
  await pool.query(
    `INSERT INTO wallet_transactions (wallet_id, user_id, type, amount, balance_before, balance_after, reference, note)
     VALUES (?, ?, 'credit', ?, ?, ?, ?, ?)`,
    [wallet.id, userId, amount, currentBal, newBal, reference, note]
  );
}

// Core Logic: Process Referral when a new user registers
async function processReferralOnSignup(newUser, referralCode) {
  if (!referralCode || !referralCode.trim()) return { success: false, reason: 'No code provided' };

  const codeClean = referralCode.trim().toUpperCase();
  const city = newUser.city || 'All';
  const userType = newUser.role || 'Client';

  const settings = await getReferralSettings(city, userType);
  if (!settings.referral_enabled) {
    return { success: false, reason: 'Referrals are disabled for this city and app.' };
  }

  const [referrers] = await pool.query('SELECT id, name, role, city FROM users WHERE UPPER(referral_code) = ? LIMIT 1', [codeClean]);
  if (!referrers.length) {
    return { success: false, reason: 'Invalid referral code' };
  }

  const referrer = referrers[0];

  if (referrer.id === newUser.id) {
    return { success: false, reason: 'You cannot use your own referral code' };
  }

  if (settings.max_referrals > 0) {
    const [refCount] = await pool.query("SELECT COUNT(*) as cnt FROM referral_logs WHERE referrer_user_id = ? AND status != 'reversed'", [referrer.id]);
    const cnt = Number((refCount[0] && (refCount[0].cnt || refCount[0].count)) || 0);
    if (cnt >= settings.max_referrals) {
      return { success: false, reason: 'Referrer has reached maximum referral limit' };
    }
  }

  await pool.query('UPDATE users SET referred_by_user_id = ?, referred_by_code = ? WHERE id = ?', [referrer.id, codeClean, newUser.id]);

  const referrerReward = parseFloat(settings.referrer_reward) || 0;
  const newUserReward = parseFloat(settings.new_user_reward) || 0;
  const isSignupReward = settings.reward_condition === 'signup';
  const status = isSignupReward ? 'rewarded' : 'pending';

  const [logRes] = await pool.query(
    `INSERT INTO referral_logs
       (referrer_user_id, referred_user_id, referral_code, city, user_type, referrer_reward_amount, new_user_reward_amount, status, reward_condition, rewarded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${isSignupReward ? 'CURRENT_TIMESTAMP' : 'NULL'})`,
    [referrer.id, newUser.id, codeClean, city, userType, referrerReward, newUserReward, status, settings.reward_condition]
  );

  if (isSignupReward) {
    if (referrerReward > 0) {
      await creditWalletBalance(
        referrer.id,
        referrerReward,
        'referral_bonus',
        `Referral bonus for inviting ${newUser.name || 'a new user'}`
      );
    }
    if (newUserReward > 0) {
      await creditWalletBalance(
        newUser.id,
        newUserReward,
        'referral_welcome',
        `Welcome reward for using referral code ${codeClean}`
      );
    }
  }

  return { success: true, logId: logRes.insertId, status };
}

// Core Logic: Process Referral when a user completes their first order
async function processReferralOnFirstOrder(userId) {
  try {
    const [pendingLogs] = await pool.query(
      `SELECT * FROM referral_logs WHERE referred_user_id = ? AND status = 'pending' AND reward_condition = 'first_order' LIMIT 1`,
      [userId]
    );
    if (!pendingLogs.length) return;

    const log = pendingLogs[0];
    const referrerReward = parseFloat(log.referrer_reward_amount) || 0;
    const newUserReward = parseFloat(log.new_user_reward_amount) || 0;

    const [referredUser] = await pool.query('SELECT name FROM users WHERE id = ?', [userId]);
    const userName = referredUser.length ? referredUser[0].name : 'a user';

    if (referrerReward > 0) {
      await creditWalletBalance(
        log.referrer_user_id,
        referrerReward,
        'referral_bonus',
        `Referral bonus after ${userName} completed first order`
      );
    }

    if (newUserReward > 0) {
      await creditWalletBalance(
        userId,
        newUserReward,
        'referral_welcome',
        `Welcome reward after completing your first order`
      );
    }

    await pool.query("UPDATE referral_logs SET status = 'rewarded', rewarded_at = CURRENT_TIMESTAMP WHERE id = ?", [log.id]);
  } catch (err) {
    console.error('Error processing first order referral reward:', err);
  }
}

// REST API: Mobile App Referral Configuration Check
const getAppReferralConfig = async (req, res) => {
  try {
    await initReferralTables();
    const city = (req.query.city || 'All').trim();
    const userType = (req.query.user_type || 'Client').trim();

    const settings = await getReferralSettings(city, userType);

    return res.json({
      success: true,
      city,
      userType,
      enabled: Boolean(settings.referral_enabled),
      maxReferrals: settings.max_referrals || 0,
      referrerReward: parseFloat(settings.referrer_reward) || 0.0,
      newUserReward: parseFloat(settings.new_user_reward) || 0.0,
      rewardCondition: settings.reward_condition || 'signup',
    });
  } catch (err) {
    console.error('Error getting referral config:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Helper: Format message text by replacing placeholders
function parseMessagePlaceholders(templateText, vars) {
  if (!templateText) return '';
  return templateText
    .replace(/\{USER_NAME\}/g, vars.userName || 'User')
    .replace(/\{REFERRAL_CODE\}/g, vars.referralCode || '')
    .replace(/\{APP_LINK\}/g, vars.appLink || '')
    .replace(/\{REWARD_AMOUNT\}/g, String(vars.rewardAmount || '0'))
    .replace(/\{SAVING_AMOUNT\}/g, String(vars.savingAmount || '0'));
}

// REST API: Get user's referral dashboard info for mobile apps
const getUserReferralDashboard = async (req, res) => {
  try {
    await initReferralTables();
    const user = req.user || (req.session && req.session.user);
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const [uRows] = await pool.query('SELECT * FROM users WHERE id = ?', [user.id]);
    if (!uRows.length) return res.status(404).json({ success: false, message: 'User not found' });
    const fullUser = uRows[0];

    const code = await ensureUserReferralCode(fullUser);
    const city = fullUser.city || 'All';
    const userType = fullUser.role || 'Client';

    const settings = await getReferralSettings(city, userType);

    if (!settings.referral_enabled) {
      return res.json({
        success: true,
        enabled: false,
        message: 'Referral program is currently not available in your area.',
      });
    }

    const [stats] = await pool.query(`
      SELECT
        COUNT(*) as total_referrals,
        SUM(CASE WHEN status = 'rewarded' THEN 1 ELSE 0 END) as successful_referrals,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_referrals,
        SUM(CASE WHEN status = 'rewarded' THEN referrer_reward_amount ELSE 0 END) as total_earnings,
        SUM(CASE WHEN status = 'pending' THEN referrer_reward_amount ELSE 0 END) as pending_rewards
      FROM referral_logs
      WHERE referrer_user_id = ?
    `, [fullUser.id]);

    const statData = stats[0] || {};

    const [history] = await pool.query(`
      SELECT 
        l.id, l.status, l.referrer_reward_amount as reward_amount, l.created_at, l.rewarded_at,
        u.name as referred_user_name, u.email as referred_user_email
      FROM referral_logs l
      LEFT JOIN users u ON l.referred_user_id = u.id
      WHERE l.referrer_user_id = ?
      ORDER BY l.id DESC
      LIMIT 50
    `, [fullUser.id]);

    const storeKey = userType.toLowerCase() === 'vendor' ? 'vendor_app_playstore_url' : userType.toLowerCase() === 'delivery' ? 'delivery_app_playstore_url' : 'client_app_playstore_url';
    const [appLinkRow] = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1', [storeKey]);
    const appLink = (appLinkRow.length && appLinkRow[0].setting_value) || 'https://jaipurgro.com';

    const [refMsgs] = await pool.query("SELECT message_text FROM referral_messages WHERE category = 'referral' AND status = 'active' ORDER BY RANDOM() LIMIT 1");
    const rawRefMsg = refMsgs.length ? refMsgs[0].message_text : 'Join JaipurGro with code {REFERRAL_CODE} and get {REWARD_AMOUNT} off! {APP_LINK}';

    const parsedShareMessage = parseMessagePlaceholders(rawRefMsg, {
      userName: fullUser.name,
      referralCode: code,
      appLink,
      rewardAmount: settings.new_user_reward || settings.referrer_reward || 0,
      savingAmount: 0,
    });

    return res.json({
      success: true,
      enabled: true,
      referralCode: code,
      referrerReward: parseFloat(settings.referrer_reward) || 0,
      newUserReward: parseFloat(settings.new_user_reward) || 0,
      totalReferrals: parseInt(statData.total_referrals, 10) || 0,
      successfulReferrals: parseInt(statData.successful_referrals, 10) || 0,
      pendingReferrals: parseInt(statData.pending_referrals, 10) || 0,
      totalEarnings: parseFloat(statData.total_earnings) || 0.0,
      pendingRewards: parseFloat(statData.pending_rewards) || 0.0,
      shareMessage: parsedShareMessage,
      history: history.map((h) => ({
        id: h.id,
        userName: h.referred_user_name || 'User',
        rewardAmount: parseFloat(h.reward_amount) || 0,
        status: h.status,
        date: h.created_at,
      })),
    });
  } catch (err) {
    console.error('Error fetching user referral dashboard:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// REST API: Get random share message for category (referral / savings)
const getShareMessage = async (req, res) => {
  try {
    await initReferralTables();
    const user = req.user || (req.session && req.session.user);
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const category = req.query.category === 'savings' ? 'savings' : 'referral';
    const savingAmount = parseFloat(req.query.saving_amount) || 0;

    const [uRows] = await pool.query('SELECT * FROM users WHERE id = ?', [user.id]);
    const fullUser = uRows.length ? uRows[0] : user;

    const code = await ensureUserReferralCode(fullUser);
    const settings = await getReferralSettings(fullUser.city, fullUser.role);

    const storeKey = (fullUser.role || '').toLowerCase() === 'vendor' ? 'vendor_app_playstore_url' : (fullUser.role || '').toLowerCase() === 'delivery' ? 'delivery_app_playstore_url' : 'client_app_playstore_url';
    const [appLinkRow] = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1', [storeKey]);
    const appLink = (appLinkRow.length && appLinkRow[0].setting_value) || 'https://jaipurgro.com';

    const [msgs] = await pool.query("SELECT message_text FROM referral_messages WHERE category = ? AND status = 'active' ORDER BY RANDOM() LIMIT 1", [category]);
    const template = msgs.length ? msgs[0].message_text : (category === 'savings' ? 'I saved ₹{SAVING_AMOUNT} on JaipurGro! Use my code {REFERRAL_CODE}: {APP_LINK}' : 'Join JaipurGro with my referral code {REFERRAL_CODE}: {APP_LINK}');

    const parsed = parseMessagePlaceholders(template, {
      userName: fullUser.name,
      referralCode: code,
      appLink,
      rewardAmount: settings.new_user_reward || settings.referrer_reward || 0,
      savingAmount,
    });

    return res.json({
      success: true,
      category,
      message: parsed,
      referralCode: code,
    });
  } catch (err) {
    console.error('Error fetching share message:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  initReferralTables,
  renderReferralSettings,
  saveReferralSettings,
  deleteReferralSettings,
  renderShareMessages,
  saveShareMessage,
  deleteShareMessage,
  toggleShareMessageStatus,
  renderReferralReport,
  reverseReferralReward,
  getAppReferralConfig,
  getUserReferralDashboard,
  getShareMessage,
  processReferralOnSignup,
  processReferralOnFirstOrder,
};
