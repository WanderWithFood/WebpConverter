/* Composite ID rule: SYSTEM-TYPE-NUMBER, for example WPC-IMG-000412.
   One database sequence per record type. The ID is built here, in the service layer.
   Sequences never go back, so an ID is never reused. */
const SEQ = { IMG: 'wpc_img_seq', KEY: 'wpc_key_seq', ACT: 'wpc_act_seq' };

async function nextId(client, type) {
  if (!SEQ[type]) throw new Error('Unknown record type ' + type);
  const r = await client.query("SELECT nextval('" + SEQ[type] + "') AS n");
  return 'WPC-' + type + '-' + String(r.rows[0].n).padStart(6, '0');
}

module.exports = { nextId };
