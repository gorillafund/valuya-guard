import { Wallet } from "ethers";
export function makeEthersSigner(privateKey, provider) {
    const wallet = provider
        ? new Wallet(privateKey, provider)
        : new Wallet(privateKey);
    return {
        async getAddress() {
            return wallet.getAddress();
        },
        async signMessage(message) {
            return wallet.signMessage(message);
        },
        async sendTransaction(tx) {
            return wallet.sendTransaction(tx);
        },
        provider: wallet.provider ?? null,
    };
}
