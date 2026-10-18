-- The service a community plan paid for on a shop wash (null for every other wash). A plan wash is
-- already prepaid and discounted, so that line earns no loyalty stamp; anything else paid on the
-- same bill still does. Recorded on the job because a plan can cover a different service on some
-- washes (Shine's every-4th Premium).
ALTER TABLE jobs ADD COLUMN plan_service_id TEXT;

-- Plan washes so far: the plan's line is the one the discount paid for.
UPDATE jobs SET plan_service_id = (
  SELECT js.service_id FROM job_services js
  WHERE js.job_id = jobs.id AND js.price_at_time = jobs.discount
  ORDER BY js.service_id LIMIT 1
)
WHERE discount_reason LIKE 'Plan wash ·%';
