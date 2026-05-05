# User Management API

Base URL: `http://localhost:3000`

## Roles

- `Admin`: backend-created only
- `Vendor`: allowed through signup
- `Client`: allowed through signup

Seeded backend Admin:

- Email: `apiadmin@example.com`
- Password: `admin123`

## Auth

### Signup

`POST /api/auth/signup`

Allowed roles: `Vendor`, `Client`

```json
{
  "name": "Fresh Vendor",
  "email": "vendor@example.com",
  "phone": "9876543210",
  "password": "secret123",
  "role": "Vendor"
}
```

### Login

`POST /api/auth/login`

```json
{
  "email": "vendor@example.com",
  "password": "secret123"
}
```

Response includes a JWT token. Send it on protected routes:

```http
Authorization: Bearer <token>
```

### Logout

`POST /api/auth/logout`

Requires JWT. The token is revoked in memory for the current server process.

## Profile

### Get Profile

`GET /api/profile`

Returns the logged-in user's common user fields and role-specific profile.

### Update Profile

`PUT /api/profile/update`

Vendor profile body:

```json
{
  "profile": {
    "business_name": "Fresh Vendor Co",
    "address": "Market Road",
    "gst_number": "GST123",
    "services": ["delivery", "packing"]
  }
}
```

Client profile body:

```json
{
  "profile": {
    "address": "221B Baker Street",
    "age": 28,
    "gender": "female",
    "notes": "Prefers evening delivery"
  }
}
```

Admin profile body:

```json
{
  "profile": {
    "permissions": ["users.manage", "profiles.manage"]
  }
}
```
