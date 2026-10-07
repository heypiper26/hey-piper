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