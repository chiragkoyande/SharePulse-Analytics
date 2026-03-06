# Workspace Owner & Super Admin Changes Documentation

## Overview
The workspace owner and super admin changes are managed through multiple routes and frontend components. Here's a comprehensive breakdown:

---

## Backend Routes

### 1. **Create Workspace with Owner** 
📍 [backend/routes/workspaces.js](backend/routes/workspaces.js#L60-L100)

**Endpoint:** `POST /workspaces`
- **Auth Required:** Super Admin only
- **Fields:** `name`, `slug`, `description`, `color`, `owner_email`
- **Logic:**
  - Creator is automatically added as **owner**
  - If `owner_email` is provided and different from creator, they are also added as **owner**
  - Multiple owners can exist in a workspace

```javascript
// Lines 60-100
router.post('/workspaces', requireAuth, requireSuperAdmin, async (req, res, next) => {
    // Creator added as owner
    await supabase.from('workspace_members').insert({
        workspace_id: workspace.id,
        user_email: req.user.email,
        role: 'owner',
    });

    // If owner_email provided, add them as owner too
    if (owner_email && owner_email !== req.user.email) {
        await supabase.from('workspace_members').insert({
            workspace_id: workspace.id,
            user_email: owner_email.toLowerCase().trim(),
            role: 'owner',
        });
    }
});
```

---

### 2. **Change Member Role (Update Member)**
📍 [backend/routes/workspaces.js](backend/routes/workspaces.js#L245-L280)

**Endpoint:** `PUT /workspaces/:workspace_id/members/:email`
- **Auth Required:** Workspace owner only (can change anyone's role except owners themselves)
- **Fields:** `role` (owner|admin|member)
- **Key Feature:** This is where roles are changed within a workspace

```javascript
// Lines 245-280
router.put('/workspaces/:workspace_id/members/:email', 
    requireAuth, 
    requireWorkspaceAccess('owner'), 
    async (req, res, next) => {
        // Only workspace owner can change roles
        const { role } = req.body;
        
        // Update the role in workspace_members table
        const { data, error } = await supabase
            .from('workspace_members')
            .update({ role })
            .eq('workspace_id', workspace_id)
            .eq('user_email', email.toLowerCase().trim())
            .select()
            .single();
    }
);
```

---

### 3. **Add Member to Workspace**
📍 [backend/routes/workspaces.js](backend/routes/workspaces.js#L207-L240)

**Endpoint:** `POST /workspaces/:workspace_id/members`
- **Auth Required:** Workspace admin or owner
- **Fields:** `email`, `role` (defaults to 'member')

---

### 4. **Remove Member from Workspace**
📍 [backend/routes/workspaces.js](backend/routes/workspaces.js#L295-L325)

**Endpoint:** `DELETE /workspaces/:workspace_id/members/:email`
- **Auth Required:** Workspace admin or owner
- **Protection:** Cannot remove workspace owners (except super admin)

```javascript
// Lines 310-315
if (targetMember.role === 'owner' && !req.user?.isSuperAdmin) {
    return res.status(403).json({ 
        success: false, 
        error: 'Admins cannot remove workspace owners' 
    });
}
```

---

### 5. **Promote User to Admin (from Admin Panel)**
📍 [backend/routes/admin.js](backend/routes/admin.js#L320-L355)

**Endpoint:** `POST /admin/promote`
- **Auth Required:** Workspace admin or super admin
- **Logic:** Promotes a user to workspace admin role
- **Validation:** User must be active in the system

```javascript
// Lines 322-352
router.post('/promote', async (req, res, next) => {
    const { email, workspace_id } = req.body;
    
    // Check user is active
    const { data: appUser } = await supabase
        .from('app_users')
        .select('email, status')
        .eq('email', normalizedEmail)
        .maybeSingle();
    
    if (!appUser || appUser.status !== 'active') {
        return res.status(400).json({ 
            success: false, 
            error: 'User must be active before promotion' 
        });
    }

    // Upsert as admin role
    await supabase.from('workspace_members').upsert(
        { workspace_id, user_email: normalizedEmail, role: 'admin' },
        { onConflict: 'workspace_id,user_email' }
    );
});
```

---

### 6. **Revoke Admin Access**
📍 [backend/routes/admin.js](backend/routes/admin.js#L358-L430)

**Endpoint:** `POST /admin/revoke`
- **Auth Required:** Workspace admin or super admin
- **Logic:** Removes a user's admin/workspace access
- **Global Option:** Super admin can revoke global admin status

---

## Frontend Components

### 1. **Admin Panel**
📍 [frontend/src/components/AdminPanel.jsx](frontend/src/components/AdminPanel.jsx)

**Key Functions:**

#### `handleWsSubmit` (Lines 166-182)
- Creates or updates workspace
- Can assign initial owner via `owner_email` field
- Super admin only

```javascript
// Line 443: Owner email input in workspace form
<input type="email" 
    placeholder="Owner email (optional)" 
    value={wsForm.owner_email}
    onChange={(e) => setWsForm({ ...wsForm, owner_email: e.target.value })} 
/>
```

#### `doAction` (Lines 135-155)
- General handler for admin actions (approve, reject, promote, revoke)
- Calls backend endpoints like `/admin/promote`

```javascript
// Lines 383: Promote button
<button className="admin-btn admin-btn--promote" 
    onClick={() => doAction('promote', { 
        email: u.email, 
        workspace_id: selectedWorkspaceId 
    })}
>Promote</button>
```

#### `handleAddMember` (Lines 176-195)
- Adds new member to workspace with specified role

#### `handleRemoveMember` (Lines 197-217)
- Removes member from workspace

---

## Access Control Hierarchy

```
Super Admin (Global)
└── isSuperAdmin = true
    └── Can:
        - Create/Delete workspaces
        - Change any user's role globally
        - Remove workspace owners
        - Revoke global admin status

Workspace Owner
└── role = 'owner' in workspace_members
    └── Can:
        - Change roles of admin/member users
        - Add/remove members
        - Update workspace details
        - Cannot remove other owners

Workspace Admin
└── role = 'admin' in workspace_members
    └── Can:
        - Add/remove members
        - Promote users to admin
        - Update workspace details
        - Cannot change roles directly (needs owner)

Workspace Member
└── role = 'member' in workspace_members
    └── Can:
        - View workspace resources
```

---

## Database Tables Involved

### `workspaces`
- Core workspace info (name, slug, description, color)
- `created_by` field tracks creator

### `workspace_members`
- Junction table linking users to workspaces
- **Key columns:**
  - `workspace_id` (UUID)
  - `user_email` (string)
  - `role` (enum: 'owner' | 'admin' | 'member')
  - `joined_at` (timestamp)

### `app_users`
- Global user records
- **Key columns:**
  - `email` (string)
  - `role` (enum: 'user' | 'admin' | 'super_admin') - GLOBAL role
  - `status` (enum: 'active' | 'revoked')

---

## Key Points to Remember

1. **Global vs Workspace Roles:**
   - `app_users.role` = Global role (user/admin/super_admin)
   - `workspace_members.role` = Workspace-specific role (owner/admin/member)

2. **Owner Protection:**
   - Only super admin can remove workspace owners
   - Workspace owners cannot be demoted by regular admins

3. **Multiple Owners:**
   - A workspace can have multiple owners
   - All owners have equal permissions within that workspace

4. **Active User Requirement:**
   - Users must be "active" in `app_users` before they can be promoted

5. **Email Normalization:**
   - All emails are lowercased and trimmed before database operations

---

## Common Operations

### Transfer Workspace Ownership
Currently NO direct "transfer" endpoint. To change owner:
1. Add new owner via `POST /workspaces/:id/members` with `role: 'owner'`
2. Remove old owner via `DELETE /workspaces/:id/members/:email`

### Promote User to Super Admin
1. Super admin goes to Admin Panel
2. Uses promote endpoint (workspace admin level)
3. To make global admin: requires direct database update or new endpoint

### Create Workspace with Owner
```
POST /workspaces (as super admin)
{
    "name": "Team Workspace",
    "owner_email": "owner@example.com"
}
```

---

## Related Files
- Migration files: `migration_v7_workspaces.sql`
- Auth middleware: [backend/middleware/authMiddleware.js](backend/middleware/authMiddleware.js)
- Workspace routes: [backend/routes/workspaces.js](backend/routes/workspaces.js)
- Admin routes: [backend/routes/admin.js](backend/routes/admin.js)
