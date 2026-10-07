import { PluggyClient } from 'pluggy-sdk';

const client = new PluggyClient({
  clientId: process.env.PLUGGY_CLIENT_ID,
  clientSecret: process.env.PLUGGY_CLIENT_SECRET,
});

export default client;
