-- People no longer ask to join a branch with its branch ID: an owner or manager adds them from
-- Team, and HQ adds owners. The requests table goes with that flow.
DROP INDEX IF EXISTS idx_join_requests_one_pending;
DROP INDEX IF EXISTS idx_join_requests_shop_status;
DROP TABLE IF EXISTS join_requests;
