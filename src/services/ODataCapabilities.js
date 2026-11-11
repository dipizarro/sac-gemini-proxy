// No runtime switch: activation requires reviewed evidence for the configured asset.
// 013/014 verified filtered SERVER_COUNT, but no nonempty continuation chain.
function forConfiguredAsset() {
    return { continuationSupported: false, serverCount: true };
}
module.exports = { forConfiguredAsset };
