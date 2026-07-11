-- Keep the Netlify functions warm: free-tier lambdas cold-start in 2-3s,
-- which staff feel as "takes forever". The database pings each endpoint
-- every 4 minutes (GET = 405 method check, exits instantly but boots the
-- instance). ~33k invocations/month across three endpoints — well inside
-- the 125k free allowance. Remove these jobs if the API moves off Netlify.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'keepwarm-chat',
  '*/4 * * * *',
  $$select net.http_get('https://sma-tonys-brain.netlify.app/api/chat')$$
);

select cron.schedule(
  'keepwarm-stt',
  '*/4 * * * *',
  $$select net.http_get('https://sma-tonys-brain.netlify.app/api/voice/stt')$$
);

select cron.schedule(
  'keepwarm-tts',
  '*/4 * * * *',
  $$select net.http_get('https://sma-tonys-brain.netlify.app/api/voice/tts')$$
);
