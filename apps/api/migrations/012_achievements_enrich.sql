ALTER TABLE achievements
  ADD COLUMN description  VARCHAR(1000) NULL          AFTER name,
  ADD COLUMN is_hidden    TINYINT(1)    NOT NULL DEFAULT 0 AFTER description,
  ADD COLUMN global_pct   DECIMAL(5,2)  NULL          AFTER is_hidden,
  ADD COLUMN dlc_app_id   INT           NULL          AFTER global_pct,
  ADD COLUMN dlc_app_name VARCHAR(255)  NULL          AFTER dlc_app_id;
