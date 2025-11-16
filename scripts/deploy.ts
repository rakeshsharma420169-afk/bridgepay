
import { ethers } from "hardhat";

async function main() {
  console.log("Deploying BridgePay...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", ethers.utils.formatEther(await deployer.getBalance()), "ETH\n");

  const BridgePay = await ethers.getContractFactory("BridgePay");
  const bridgePay = await BridgePay.deploy();
  await bridgePay.deployed();

  console.log("✅ BridgePay deployed to:", bridgePay.address);
  console.log("\nSave this address for the server!");
  console.log("CONTRACT_ADDRESS=" + bridgePay.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });