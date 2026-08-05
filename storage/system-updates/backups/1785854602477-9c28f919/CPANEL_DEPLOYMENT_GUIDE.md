# cPanel Node.js Deployment Guide for JaipurGro2

Yeh document aapko **JaipurGro2 Node.js Application** ko cPanel par deploy karne me step-by-step help karega.

---

## 1. ZIP File Upload & Extract
1. cPanel me login karein aur **File Manager** open karein.
2. Domain ya Subdomain ki directory choose karein (ya home directory me `jaipurgro2` folder banayein).
3. `jaipurgro2_cpanel_deploy.zip` file upload karein aur compress file ko **Extract** (unzip) kar lein.

---

## 2. Environment Variables Configuration (.env Setup)
1. File Manager me `.env.example` file ko duplicate / copy karke naya file banayein jiska naam `.env` rakhein.
2. `.env` file edit karke apni production database details fill karein:
   ```env
   # PostgreSQL Database Details (cPanel / Remote DB)
   DB_HOST=localhost (ya remote database host IP)
   DB_PORT=5432
   DB_USER=your_cpanel_db_username
   DB_PASSWORD=your_cpanel_db_password
   DB_NAME=your_cpanel_db_name
   DB_SSL=false

   # Firebase / Extra Configs (agar aap use kar rahe hain)
   FIREBASE_WEB_API_KEY=your_key
   FIREBASE_PROJECT_ID=your_project_id
   ...
   ```

---

## 3. Setup Node.js App in cPanel
1. cPanel Dashboard me **Software** section ke andar **Setup Node.js App** par click karein.
2. **Create Application** button par click karein.
3. Form me ye details fill karein:
   - **Node.js version**: Choose `24.x` (or `24.18.0`).
   - **Application mode**: `Production`
   - **Application root**: `jaipurgro2` (jaha aapne zip extract kiya hai).
   - **Application URL**: Select your domain/subdomain.
   - **Application startup file**: `app.js`
4. **Create** button par click karein.

---

## 4. Install NPM Dependencies
1. App create hone ke baad page ke top par ek green command line bar dikhai degi (e.g. `source /home/username/nodevenv/jaipurgro2/18/bin/activate`).
2. cPanel page par **Run NPM Install** button dikhega, us par click karein.
3. *(Alternative)*: cPanel **Terminal** open karke vo command enter karein aur `npm install` run karein.

---

## 5. Database Setup (Separately)
1. cPanel **PostgreSQL Databases** (ya MySQL agar MySQL DB hai) me jaakar DB Name, User, aur Password create karein.
2. User ko DB ki saari permissions assign karein.
3. **pgAdmin** ya Terminal/PHPMyAdmin se apna `.sql` backup file import karein.
4. `.env` file me sahi DB_USER, DB_PASSWORD, DB_NAME update karein.

---

## 6. Restart Application & Test
1. cPanel Node.js App page par wapas aakar **Restart Application** par click karein.
2. Domain / URL browser me open karke test karein.

---
**Note:** `node_modules` ko zip me shamil nahi kiya gaya hai kyunki server environment (Linux) local environment (Windows) se alag hota hai. Server par `Run NPM Install` karne se Linux-compatible libraries build ho jayengi.
