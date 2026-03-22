import { WormholeBridge } from "../src/wormhole/WormholeBridge";

(async () => {
  try {
    const bridge = new WormholeBridge();
    await bridge.init();

    console.log("🔍 Estimating...");

    const quote = await bridge.estimate({
      from: "Sepolia",
      to: "PolygonSepolia",
      token: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      amount: "0.01",
    });

    console.log("QUOTE:", quote);

    console.log("🔧 Testing attestation only...");

    const wrapped = await bridge.ensureWrappedToken({
      from: "Sepolia",
      to: "PolygonSepolia",
      token: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    });

    console.log("WRAPPED:", wrapped);

    
    console.log("🚀 Sending transfer...");

    const result = await bridge.transfer({
      from: "Sepolia",
      to: "PolygonSepolia",
      token: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      amount: "0.01",
      ensureWrapped: false, 
    });

    console.log("✅ RESULT:", result);
    

  } catch (err) {
    console.error("ERROR:", err);
  }
})();