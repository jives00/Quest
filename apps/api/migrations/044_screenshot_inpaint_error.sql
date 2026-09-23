-- Why the gaming-PC agent could not paint a shot's UI out. Shown in the review
-- lightbox so a "Fill failed" badge explains itself without reading the agent's
-- log. Cleared whenever the shot goes back on the queue or a clean arrives.
ALTER TABLE screenshots
  ADD COLUMN inpaint_error VARCHAR(500) NULL AFTER inpaint_mask_version;
