const pool = require('../db');

const DEFAULT_VEHICLES = [
  ['Bicycle', 'bicycle', 15, 5, 10],
  ['Bike', 'bike', 20, 20, 20],
  ['Scooter', 'scooter', 25, 60, 30],
  ['Auto', 'auto', 40, 100, 40],
  ['Mini Truck', 'mini-truck', 80, 500, 50],
];

const DEFAULT_SLABS = [
  ['0-5 kg', 0, 5, 0, 4, 0, 15],
  ['Above 5-20 kg', 5, 20, 15, 5, 0, 20],
  ['Above 20-60 kg', 20, 60, 35, 7, 0, 30],
  ['Above 60-100 kg', 60, 100, 70, 10, 0, 50],
];

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function active(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

async function initSchema(connection = pool) {
  await connection.query(`CREATE TABLE IF NOT EXISTS vehicle_categories (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT, name VARCHAR(100) NOT NULL, code VARCHAR(60) NOT NULL,
    base_delivery_charge DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    max_supported_weight_kg DECIMAL(10,3) NOT NULL DEFAULT 100.000,
    priority INT NOT NULL DEFAULT 100, is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY uq_vehicle_category_code (code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await connection.query(`CREATE TABLE IF NOT EXISTS default_delivery_rules (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT, vehicle_category_id INT UNSIGNED NOT NULL,
    rule_name VARCHAR(120) DEFAULT NULL, min_weight_kg DECIMAL(10,3) NOT NULL DEFAULT 0.000,
    max_weight_kg DECIMAL(10,3) NOT NULL, slab_charge DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    price_per_km DECIMAL(12,2) NOT NULL DEFAULT 0.00, additional_charge DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    night_charge_increment DECIMAL(12,2) NOT NULL DEFAULT 0.00, is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY uq_default_vehicle_slab (vehicle_category_id, min_weight_kg, max_weight_kg)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await connection.query(`CREATE TABLE IF NOT EXISTS area_delivery_rules (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT, area_definition_id INT UNSIGNED NOT NULL,
    vehicle_category_id INT UNSIGNED NOT NULL, source_default_rule_id INT UNSIGNED DEFAULT NULL,
    rule_name VARCHAR(120) DEFAULT NULL, min_weight_kg DECIMAL(10,3) NOT NULL DEFAULT 0.000,
    max_weight_kg DECIMAL(10,3) NOT NULL, slab_charge DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    price_per_km DECIMAL(12,2) NOT NULL DEFAULT 0.00, additional_charge DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    night_charge_increment DECIMAL(12,2) NOT NULL DEFAULT 0.00, is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY uq_area_vehicle_slab (area_definition_id, vehicle_category_id, min_weight_kg, max_weight_kg),
    KEY idx_area_delivery_match (area_definition_id, vehicle_category_id, is_active, min_weight_kg, max_weight_kg)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  for (const [name, code, baseCharge, maxWeight, priority] of DEFAULT_VEHICLES) {
    await connection.query(`INSERT INTO vehicle_categories
      (name, code, base_delivery_charge, max_supported_weight_kg, priority, is_active)
      SELECT ?, ?, ?, ?, ?, 1 WHERE NOT EXISTS (SELECT 1 FROM vehicle_categories WHERE code = ?)`,
    [name, code, baseCharge, maxWeight, priority, code]);
  }
  const vehicles = await listVehicles(connection);
  for (const vehicle of vehicles) {
    for (const slab of DEFAULT_SLABS) {
      const [ruleName, minWeight, maxWeight, slabCharge, perKm, additional, night] = slab;
      if (maxWeight > vehicle.max_supported_weight_kg) continue;
      await connection.query(`INSERT INTO default_delivery_rules
        (vehicle_category_id, rule_name, min_weight_kg, max_weight_kg, slab_charge, price_per_km, additional_charge, night_charge_increment, is_active)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, 1 WHERE NOT EXISTS (
          SELECT 1 FROM default_delivery_rules WHERE vehicle_category_id = ? AND min_weight_kg = ? AND max_weight_kg = ?
        )`, [vehicle.id, ruleName, minWeight, maxWeight, slabCharge, perKm, additional, night, vehicle.id, minWeight, maxWeight]);
    }
  }
  const [areas] = await connection.query('SELECT id FROM area_definitions');
  for (const area of areas) await ensureAreaRules(area.id, connection);
}

async function listVehicles(connection = pool) {
  const [rows] = await connection.query('SELECT * FROM vehicle_categories ORDER BY priority, name');
  return rows.map((row) => ({ ...row, base_delivery_charge: number(row.base_delivery_charge), max_supported_weight_kg: number(row.max_supported_weight_kg), priority: number(row.priority), is_active: Boolean(row.is_active) }));
}

async function saveVehicle(data, connection = pool) {
  const id = number(data.id);
  const name = String(data.name || '').trim();
  const code = String(data.code || name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!name || !code) { const error = new Error('Vehicle category name is required'); error.status = 422; throw error; }
  const values = [name, code, Math.max(0, number(data.base_delivery_charge)), Math.max(0, number(data.max_supported_weight_kg, 100)), number(data.priority, 100), active(data.is_active) ? 1 : 0];
  if (id) {
    await connection.query('UPDATE vehicle_categories SET name=?, code=?, base_delivery_charge=?, max_supported_weight_kg=?, priority=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [...values, id]);
    return id;
  }
  const [result] = await connection.query('INSERT INTO vehicle_categories (name,code,base_delivery_charge,max_supported_weight_kg,priority,is_active) VALUES (?,?,?,?,?,?)', values);
  return result.insertId;
}

async function deleteVehicle(id, connection = pool) {
  const [used] = await connection.query('SELECT COUNT(*) count FROM default_delivery_rules WHERE vehicle_category_id=?', [id]);
  if (number(used[0] && used[0].count)) { const error = new Error('Delete this vehicle’s default slabs first'); error.status = 409; throw error; }
  await connection.query('DELETE FROM area_delivery_rules WHERE vehicle_category_id=?', [id]);
  await connection.query('DELETE FROM vehicle_categories WHERE id=?', [id]);
}

async function listDefaultRules(connection = pool) {
  const [rows] = await connection.query(`SELECT ddr.*, vc.name vehicle_name, vc.code vehicle_code, vc.base_delivery_charge, vc.max_supported_weight_kg
    FROM default_delivery_rules ddr INNER JOIN vehicle_categories vc ON vc.id=ddr.vehicle_category_id
    ORDER BY vc.priority, ddr.min_weight_kg, ddr.max_weight_kg`);
  return rows.map(normalizeRule);
}

function normalizeRule(row) {
  return { ...row, min_weight_kg: number(row.min_weight_kg), max_weight_kg: number(row.max_weight_kg), slab_charge: number(row.slab_charge), price_per_km: number(row.price_per_km), additional_charge: number(row.additional_charge), night_charge_increment: number(row.night_charge_increment), base_delivery_charge: number(row.base_delivery_charge), is_active: Boolean(row.is_active) };
}

function ruleValues(data) {
  const min = Math.max(0, number(data.min_weight_kg));
  const max = Math.max(0, number(data.max_weight_kg));
  if (max <= min || max > 100) { const error = new Error('Maximum weight must be greater than minimum weight and no more than 100 kg'); error.status = 422; throw error; }
  return [number(data.vehicle_category_id), String(data.rule_name || `${min}-${max} kg`).trim(), min, max, Math.max(0, number(data.slab_charge)), Math.max(0, number(data.price_per_km)), Math.max(0, number(data.additional_charge)), Math.max(0, number(data.night_charge_increment)), active(data.is_active) ? 1 : 0];
}

async function saveDefaultRule(data, connection = pool) {
  const id = number(data.id); const values = ruleValues(data);
  if (id) { await connection.query('UPDATE default_delivery_rules SET vehicle_category_id=?,rule_name=?,min_weight_kg=?,max_weight_kg=?,slab_charge=?,price_per_km=?,additional_charge=?,night_charge_increment=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', [...values,id]); return id; }
  const [result] = await connection.query('INSERT INTO default_delivery_rules (vehicle_category_id,rule_name,min_weight_kg,max_weight_kg,slab_charge,price_per_km,additional_charge,night_charge_increment,is_active) VALUES (?,?,?,?,?,?,?,?,?)', values);
  return result.insertId;
}

async function deleteDefaultRule(id, connection = pool) { await connection.query('DELETE FROM default_delivery_rules WHERE id=?', [id]); }

async function ensureAreaRules(areaId, connection = pool) {
  const [existing] = await connection.query('SELECT COUNT(*) count FROM area_delivery_rules WHERE area_definition_id=?', [areaId]);
  if (number(existing[0] && existing[0].count) > 0) return 0;
  const [result] = await connection.query(`INSERT INTO area_delivery_rules
    (area_definition_id,vehicle_category_id,source_default_rule_id,rule_name,min_weight_kg,max_weight_kg,slab_charge,price_per_km,additional_charge,night_charge_increment,is_active)
    SELECT ?, d.vehicle_category_id, d.id, d.rule_name, d.min_weight_kg, d.max_weight_kg, d.slab_charge, d.price_per_km, d.additional_charge, d.night_charge_increment, d.is_active
    FROM default_delivery_rules d`, [areaId]);
  return number(result.affectedRows ?? result.rowCount ?? 0);
}

async function listAreaRules(filters = {}, connection = pool) {
  const params=[]; let where='WHERE 1=1';
  if (filters.areaId) { where += ' AND adr.area_definition_id=?'; params.push(number(filters.areaId)); }
  const [rows] = await connection.query(`SELECT adr.*, ad.name area_name, ad.city, vc.name vehicle_name, vc.code vehicle_code, vc.base_delivery_charge, vc.max_supported_weight_kg
    FROM area_delivery_rules adr INNER JOIN area_definitions ad ON ad.id=adr.area_definition_id
    INNER JOIN vehicle_categories vc ON vc.id=adr.vehicle_category_id ${where}
    ORDER BY LOWER(ad.city), LOWER(ad.name), vc.priority, adr.min_weight_kg`, params);
  return rows.map(normalizeRule);
}

async function saveAreaRule(data, connection = pool) {
  const id=number(data.id); const areaId=number(data.area_definition_id); if(!areaId){const error=new Error('Area is required');error.status=422;throw error;}
  const values=ruleValues(data);
  if(id){await connection.query('UPDATE area_delivery_rules SET area_definition_id=?,vehicle_category_id=?,rule_name=?,min_weight_kg=?,max_weight_kg=?,slab_charge=?,price_per_km=?,additional_charge=?,night_charge_increment=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[areaId,...values,id]);return id;}
  const [result]=await connection.query('INSERT INTO area_delivery_rules (area_definition_id,vehicle_category_id,rule_name,min_weight_kg,max_weight_kg,slab_charge,price_per_km,additional_charge,night_charge_increment,is_active) VALUES (?,?,?,?,?,?,?,?,?,?)',[areaId,...values]);return result.insertId;
}

async function deleteAreaRule(id, connection=pool){await connection.query('DELETE FROM area_delivery_rules WHERE id=?',[id]);}

async function detectArea(input, connection=pool){
  if(number(input.areaDefinitionId)) return number(input.areaDefinitionId);
  const area=String(input.area||'').trim(); const city=String(input.city||'').trim();
  if(!area) return null;
  const [rows]=await connection.query('SELECT id FROM area_definitions WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) AND (?="" OR LOWER(TRIM(city))=LOWER(TRIM(?))) LIMIT 1',[area,city,city]);
  return rows[0] ? number(rows[0].id) : null;
}

async function resolvePricing(input, connection=pool){
  const weight=Math.max(0,number(input.totalWeightKg)); const areaId=await detectArea(input,connection);
  let vehicleWhere='vc.is_active=1 AND vc.max_supported_weight_kg>=?'; const vehicleParams=[weight];
  if(number(input.vehicleCategoryId)){vehicleWhere='vc.is_active=1 AND vc.id=?';vehicleParams[0]=number(input.vehicleCategoryId);}
  else if(input.vehicleCategory){vehicleWhere='vc.is_active=1 AND LOWER(vc.code)=LOWER(?)';vehicleParams[0]=String(input.vehicleCategory);}
  const [vehicles]=await connection.query(`SELECT vc.* FROM vehicle_categories vc WHERE ${vehicleWhere} ORDER BY vc.max_supported_weight_kg,vc.priority LIMIT 1`,vehicleParams);
  const vehicle=vehicles[0]; if(!vehicle) return null;
  let rows=[];
  if(areaId){[rows]=await connection.query(`SELECT adr.* FROM area_delivery_rules adr WHERE adr.area_definition_id=? AND adr.vehicle_category_id=? AND adr.is_active=1 AND ?>=adr.min_weight_kg AND ?<=adr.max_weight_kg ORDER BY adr.min_weight_kg DESC LIMIT 1`,[areaId,vehicle.id,weight,weight]);}
  let source='area';
  if(!rows.length){source='default';[rows]=await connection.query(`SELECT ddr.* FROM default_delivery_rules ddr WHERE ddr.vehicle_category_id=? AND ddr.is_active=1 AND ?>=ddr.min_weight_kg AND ?<=ddr.max_weight_kg ORDER BY ddr.min_weight_kg DESC LIMIT 1`,[vehicle.id,weight,weight]);}
  if(!rows.length) return null;
  return {source,area_definition_id:areaId,vehicle:{...vehicle,base_delivery_charge:number(vehicle.base_delivery_charge),max_supported_weight_kg:number(vehicle.max_supported_weight_kg)},rule:normalizeRule(rows[0])};
}

module.exports={initSchema,listVehicles,saveVehicle,deleteVehicle,listDefaultRules,saveDefaultRule,deleteDefaultRule,ensureAreaRules,listAreaRules,saveAreaRule,deleteAreaRule,resolvePricing};
