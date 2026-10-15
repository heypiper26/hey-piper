import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
  max: 1,
  prepare: false,
  // Warm serverless instances hold this connection between invocations; without
  // these limits the Supabase pooler (or NAT) silently drops the idle socket and
  // the next query hangs forever on a dead connection — the "dashboard never
  // loads until the instance recycles" failure seen in production.
  idle_timeout: 20,    // close idle connections before someone else kills them
  max_lifetime: 300,   // recycle any connection after 5 min regardless
  connect_timeout: 10, // fail fast so the client-side retry can open a fresh one
  // One query on the wire at a time. By default postgres.js pipelines queued queries on the
  // connection, and through the Supabase transaction pooler a pipeline that mixes in a few
  // parameterless (simple-protocol) queries never gets its replies — every query behind it on
  // this single connection then hangs too. A Dashboard load queues enough of them to hit it.
  max_pipeline: 0,
  types: {
    numeric: {
      to: 1700,
      from: [1700],
      serialize: (x) => String(x),
      parse: (x) => parseFloat(x),
    },
  },
});

export default sql;