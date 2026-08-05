# Superadmin Role Management System

## Overview
A comprehensive role-based access control (RBAC) system with support for hierarchical roles (parent-child relationships), permission management, and user assignment.

## Features

### 1. Role Management
- **Create Roles**: Define new roles with unique slugs
- **Edit Roles**: Update role details, permissions, parent roles, and levels
- **Delete Roles**: Remove roles with cascade protection (cannot delete superadmin)
- **List All Roles**: View all roles with hierarchy and user assignment counts

### 2. Role Hierarchy (Parent-Child Support)
- Roles can have parent roles for inheritance
- Child roles inherit permissions from parents
- Visual indication of parent-child relationships
- Level-based system (0-3) for organizational hierarchy

### 3. Permission System
- **All Access**: Full system access
- **Manage Users**: User management capabilities
- **Manage Roles**: Role creation, editing, deletion
- **Manage Products**: Product catalog management
- **Manage Orders**: Order processing and tracking
- **View Reports**: Access to analytics and reports
- **Manage Settings**: System configuration
- **Manage Inventory**: Inventory control

### 4. User Role Assignment
- Assign multiple roles to users
- Remove roles from users via interactive UI
- Real-time assignment status updates
- Searchable user list with instant filtering
- User count per role displayed

### 5. Built-in Roles
- **Super Admin** (Level 0): Full system access, auto-created on first run
  - Email: superadmin@example.com
  - Password: admin123

## Database Schema

### Roles Table
```sql
CREATE TABLE roles (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL UNIQUE,
  slug VARCHAR(100) NOT NULL UNIQUE,
  description TEXT DEFAULT NULL,
  parent_id INT UNSIGNED DEFAULT NULL,
  level INT NOT NULL DEFAULT 0,
  permissions JSON DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_parent FOREIGN KEY (parent_id) REFERENCES roles(id) ON DELETE SET NULL
);
```

### User_Roles Junction Table
```sql
CREATE TABLE user_roles (
  user_id INT UNSIGNED NOT NULL,
  role_id INT UNSIGNED NOT NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  assigned_by INT UNSIGNED DEFAULT NULL,
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_role_id FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);
```

## Routes

### Authentication
- `GET /` - Login page (redirects to dashboard if logged in)
- `POST /login` - Authenticate user
- `GET /dashboard` - Superadmin dashboard (protected)
- `GET /logout` - Logout and destroy session

### Role Management (Protected)

#### List Roles
- `GET /roles` - View all roles with hierarchy and user counts

#### Create Role
- `GET /roles/create` - Show role creation form
- `POST /roles/store` - Create new role

#### Edit Role
- `GET /roles/edit/:id` - Show role edit form
- `POST /roles/update/:id` - Update existing role

#### Delete Role
- `POST /roles/delete/:id` - Delete role (cannot delete superadmin)

#### Assign Users
- `GET /roles/assign/:id` - Show user assignment interface with search
- `POST /roles/assign-user` - API endpoint to assign/unassign users (AJAX)

## Role Levels

- **Level 0**: System Admin (highest privilege, e.g., Super Admin)
- **Level 1**: Senior Role (department heads, senior managers)
- **Level 2**: Mid Level (managers, supervisors)
- **Level 3**: Junior Role (staff, operators)

## Validation Rules

1. **Slug Format**: Must contain only lowercase letters, numbers, hyphens, or underscores
2. **Unique Names**: Role names must be unique across the system
3. **Unique Slugs**: Role slugs must be unique across the system
4. **Superadmin Protection**: Cannot delete or modify the Super Admin role
5. **Cascade Protection**: Deleting a parent role sets child parent_id to NULL

## Security Features

- All role management routes protected by `requireAuth` middleware
- Session-based authentication with 1-hour expiry
- Password hashing using bcrypt (10 rounds)
- SQL injection prevention via parameterized queries
- CSRF protection through session management
- Input validation and sanitization
- Permission validation on role operations

## Usage Examples

### Creating a New Role
1. Navigate to `/roles/create`
2. Enter role name (e.g., "Product Manager")
3. Enter slug (e.g., "product-manager")
4. Add optional description
5. Select parent role (optional) for inheritance
6. Set appropriate level (1-3)
7. Check relevant permissions
8. Click "Create Role"

### Assigning Users to Roles
1. Navigate to `/roles/assign/:id` (replace :id with role ID)
2. View current assignments and statistics
3. Search for users by name or email
4. Click "Assign" to add user to role
5. Click "Remove" to remove user from role
6. Changes saved in real-time via AJAX

### Editing Roles
1. Navigate to `/roles/edit/:id`
2. Update name, slug, description, or permissions
3. Change parent role or level as needed
4. Click "Update Role"
5. All users retain their role assignment

### Deleting Roles
1. Navigate to `/roles` list
2. Click "Delete" on any role (except Super Admin)
3. Confirm deletion in popup
4. Role removed from all users automatically
5. Child roles have parent set to NULL

## User Interface Features

### Dashboard
- Role management quick access button
- User and system statistics
- Navigation menu to all management sections
- Visual role badges (color-coded by level)

### Role Cards
- Display role name, slug, description
- Show parent role relationship
- Display user count
- Show creation date
- Edit, assign users, delete actions

### Role Forms
- Clean, intuitive form layout
- Permission checkboxes with descriptions
- Parent role dropdown with level indicators
- Real-time slug validation
- Success/error feedback messages

### User Assignment Page
- Role statistics (total users, assigned, available)
- Searchable user list
- Visual assignment status indicators
- Instant save via AJAX
- Filter and search capabilities

## File Structure

```
Server_node/
├── app.js                 # Main application (role management routes)
├── db.js                  # Database utilities
├── public/
│   └── styles.css         # Shared CSS styles
└── views/
    ├── login.ejs          # Login page
    ├── dashboard.ejs      # Superadmin dashboard
    ├── roles_list.ejs     # List all roles
    ├── role_form.ejs      # Create/edit role form
    └── role_assign.ejs    # User assignment interface
```

## Initial Setup

1. Start the application: `node app.js`
2. Database and tables auto-created
3. Superadmin role auto-created (level 0)
4. Superadmin user auto-created:
   - Email: superadmin@example.com
   - Password: admin123

## API Response Format

### Success Response
```json
{
  "success": true,
  "message": "Operation completed successfully"
}
```

### Error Response
```json
{
  "success": false,
  "message": "Error description"
}
```

## Future Enhancements

- Role permission inheritance visualization
- Role cloning/copy functionality
- Bulk user assignment
- Role audit log (track changes)
- Export roles to CSV
- Permission templates
- Multi-role per user support (currently via junction table)

## Support

For issues or questions, contact the development team.
