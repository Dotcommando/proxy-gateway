const { createProxyGateway } = require('@echospecter/proxy-gateway');

async function main() {
  const { assertGatewaySmoke } = await import('./smoke-common.mjs');

  await assertGatewaySmoke(createProxyGateway, 'cjs require');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
