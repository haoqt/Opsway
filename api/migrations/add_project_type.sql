-- Migration: Add project_type system (Odoo vs Generic)
-- Applied: project.project_type, project.postgres_version, project.odoo_workers, project.odoo_image_override
-- Applied: branch.postgres_version, branch.odoo_image, branch.custom_addons_path

-- ── Project table changes ──────────────────────────────────────
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type VARCHAR(10) NOT NULL DEFAULT 'odoo';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS postgres_version VARCHAR(30) DEFAULT 'postgres:16-alpine';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS odoo_workers INTEGER DEFAULT 2;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS odoo_image_override VARCHAR(512);

-- ── Branch table changes ───────────────────────────────────────
ALTER TABLE branches ADD COLUMN IF NOT EXISTS postgres_version VARCHAR(30);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS odoo_image VARCHAR(512);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS custom_addons_path VARCHAR(255);

-- Set existing projects to 'odoo' type (backward compatible)
UPDATE projects SET project_type = 'odoo' WHERE project_type IS NULL;
