// Fails unless every enabled deployment reachable from the fornace-max group
// advertises an input context strictly larger than 128K.
const base = (process.env.MANTICE_ADMIN_URL ?? "https://llm.fornace.net")
  .replace(/\/+$/, "")
  .replace(/\/v1$/, "");
const adminKey = process.env.MANTICE_ADMIN_TOKEN;
const modelKey = process.env.MANTICE_API_KEY ?? adminKey;
if (!adminKey) throw new Error("MANTICE_ADMIN_TOKEN is required");
if (!modelKey) throw new Error("MANTICE_API_KEY or MANTICE_ADMIN_TOKEN is required");

async function json(path, key) {
  const response = await fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

const [routing, cards, models] = await Promise.all([
  json("/admin/routing", adminKey),
  json("/admin/model-cards", adminKey),
  json("/v1/models", modelKey),
]);
const groups = new Set(["fornace-max"]);
const queue = ["fornace-max"];
while (queue.length) {
  const group = queue.shift();
  for (const target of routing.fallbacks?.[group] ?? []) {
    if (!groups.has(target)) {
      groups.add(target);
      queue.push(target);
    }
  }
}
const deployments = (routing.deployments ?? []).filter(
  (deployment) => deployment.enabled && groups.has(deployment.model_group),
);
if (!deployments.length) throw new Error("fornace-max chain has no enabled deployments");
const cardsByDeployment = new Map(
  (cards.data ?? []).map((card) => [card.deployment_id, card]),
);
const checked = deployments.map((deployment) => {
  const card = cardsByDeployment.get(deployment.id);
  if (!card) throw new Error(`${deployment.id} has no model card`);
  const context = card.card?.limits?.max_input_tokens;
  if (!Number.isFinite(context)) {
    throw new Error(`${deployment.id} has no finite max_input_tokens`);
  }
  if (context <= 128_000) {
    throw new Error(`${deployment.id} (${deployment.upstream_model}) is ${context}, expected >128000`);
  }
  return {
    group: deployment.model_group,
    deployment: deployment.id,
    model: deployment.upstream_model,
    context_window: context,
  };
});
for (const id of ["fornace-max", "max"]) {
  const model = (models.data ?? []).find((candidate) => candidate.id === id);
  if (!model || model.context_window <= 128_000) {
    throw new Error(`${id} public context must exceed 128000`);
  }
}
checked.sort((left, right) => left.context_window - right.context_window);
console.log(JSON.stringify({
  routing_revision: routing.revision,
  groups: [...groups],
  deployments: checked,
  minimum_context_window: checked[0].context_window,
}, null, 2));
