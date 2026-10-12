-- name: CreateProject :one
INSERT INTO projects (clerk_user_id, title, topic, site_model, learning_record)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetProjectForOwner :one
SELECT * FROM projects
WHERE id = $1 AND clerk_user_id = $2;

-- name: ListProjectsForOwner :many
SELECT * FROM projects
WHERE clerk_user_id = $1
ORDER BY updated_at DESC;

-- name: UpdateProjectForOwner :one
UPDATE projects
SET title = $3, topic = $4, site_model = $5, learning_record = $6, version = version + 1, updated_at = NOW()
WHERE id = $1 AND clerk_user_id = $2
RETURNING *;

-- name: DeleteProjectForOwner :one
DELETE FROM projects
WHERE id = $1 AND clerk_user_id = $2
RETURNING id;
