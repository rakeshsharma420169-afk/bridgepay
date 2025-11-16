
import { expect } from "chai";
import { ethers } from "hardhat";

describe("BridgePay", function () {
  it("Should deploy successfully", async function () {
    const BridgePay = await ethers.getContractFactory("BridgePay");
    const bridgePay = await BridgePay.deploy();
    await bridgePay.deployed();
    
    expect(bridgePay.address).to.not.equal("");
    console.log("✅ Contract deployed to:", bridgePay.address);
  });

  it("Should allow deposits", async function () {
    const BridgePay = await ethers.getContractFactory("BridgePay");
    const bridgePay = await BridgePay.deploy();
    await bridgePay.deployed();
    
    const [owner] = await ethers.getSigners();
    await bridgePay.deposit({ value: ethers.utils.parseEther("1.0") });
    
    const balance = await bridgePay.getBalance(owner.address);
    expect(balance).to.equal(ethers.utils.parseEther("1.0"));
    console.log("✅ Deposit successful, balance:", ethers.utils.formatEther(balance), "ETH");
  });
});
