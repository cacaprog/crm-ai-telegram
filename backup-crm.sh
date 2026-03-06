#!/bin/bash
set -e
TIMESTAMP=$(date +%Y-%m-%d_%H-%M)
FILE="/tmp/crm_backup_${TIMESTAMP}.sql.gz"
pg_dump -U crm_user -h localhost crm_db | gzip > "$FILE"
rclone copy "$FILE" r2:crm-backups/
rm "$FILE"
echo "Backup complete: $FILE"
