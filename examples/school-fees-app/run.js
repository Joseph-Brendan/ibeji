const [provider, mode] = process.argv.slice(2);

if (
  (provider !== "paystack" && provider !== "flutterwave") ||
  (mode !== "naive" && mode !== "safe")
) {
  console.error("Usage: node examples/school-fees-app/run.js <paystack|flutterwave> <naive|safe>");
  process.exit(2);
}

process.env.PAYMENT_PROVIDER = provider;
process.env.APP_MODE = mode;

await import("./server.js");
