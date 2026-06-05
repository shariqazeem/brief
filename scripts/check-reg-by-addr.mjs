// Quick reg + reputation reader. node --env-file=.env.local scripts/check-reg-by-addr.mjs <addr>
const URLS = ["https://rpc.testnet.sui.io:443","https://sui-testnet-rpc.publicnode.com","https://sui-testnet-endpoint.blockvision.org"];

async function rpc(method, params) {
  let last;
  for (const u of URLS) {
    try {
      const r = await fetch(u, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { last = e; }
  }
  throw last ?? new Error("all rpc failed");
}

const PKG = process.env.NEXT_PUBLIC_BRIEF_PACKAGE_ID;
const wantAddrs = process.argv.slice(2);
if (wantAddrs.length === 0) {
  console.error("usage: node scripts/check-reg-by-addr.mjs <addr>...");
  process.exit(1);
}
const r = await rpc("suix_queryEvents", [
  { MoveEventType: `${PKG}::agent_registry::AgentRegistered` },
  null, 200, true
]);
const seen = new Set();
for (const ev of r.data) {
  const p = ev.parsedJson;
  if (!wantAddrs.includes(p.agent_address)) continue;
  if (seen.has(p.agent_address)) continue;
  seen.add(p.agent_address);
  const tx = await rpc("sui_getTransactionBlock", [ev.id.txDigest, {showObjectChanges:true}]);
  const created = (tx.objectChanges||[]).find(c => c.type==='created' && c.objectType?.includes('::agent_registry::AgentRegistration'));
  if (!created?.objectId) continue;
  const obj = await rpc("sui_getObject", [created.objectId, {showContent:true}]);
  const f = obj.data.content.fields;
  console.log(JSON.stringify({
    address: p.agent_address,
    reg_id: created.objectId,
    display_name: f.display_name,
    capabilities: f.capabilities,
    reputation_score: f.reputation_score,
    completed_tasks: f.completed_tasks,
    total_paid_mist: f.total_paid,
  }, null, 2));
}
