pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract GeoCache_FHE is ZamaEthereumConfig {
    struct Treasure {
        euint32 encryptedLatitude;
        euint32 encryptedLongitude;
        uint256 publicHint;
        uint256 rewardAmount;
        address creator;
        bool isActive;
        bool isClaimed;
    }

    struct Player {
        address playerAddress;
        uint256 lastClaimTime;
        uint256 totalRewards;
    }

    mapping(uint256 => Treasure) public treasures;
    mapping(address => Player) public players;
    uint256 public treasureCount;

    event TreasureCreated(uint256 indexed treasureId, address indexed creator);
    event TreasureClaimed(uint256 indexed treasureId, address indexed player);
    event PlayerRegistered(address indexed player);

    constructor() ZamaEthereumConfig() {
        treasureCount = 0;
    }

    function createTreasure(
        externalEuint32 encryptedLatitude,
        bytes calldata latitudeProof,
        externalEuint32 encryptedLongitude,
        bytes calldata longitudeProof,
        uint256 publicHint,
        uint256 rewardAmount
    ) external {
        require(rewardAmount > 0, "Reward amount must be positive");

        euint32 latitude = FHE.fromExternal(encryptedLatitude, latitudeProof);
        euint32 longitude = FHE.fromExternal(encryptedLongitude, longitudeProof);

        require(FHE.isInitialized(latitude), "Invalid encrypted latitude");
        require(FHE.isInitialized(longitude), "Invalid encrypted longitude");

        FHE.allowThis(latitude);
        FHE.allowThis(longitude);

        FHE.makePubliclyDecryptable(latitude);
        FHE.makePubliclyDecryptable(longitude);

        uint256 treasureId = treasureCount++;
        treasures[treasureId] = Treasure({
            encryptedLatitude: latitude,
            encryptedLongitude: longitude,
            publicHint: publicHint,
            rewardAmount: rewardAmount,
            creator: msg.sender,
            isActive: true,
            isClaimed: false
        });

        emit TreasureCreated(treasureId, msg.sender);
    }

    function registerPlayer() external {
        require(players[msg.sender].playerAddress == address(0), "Player already registered");
        players[msg.sender] = Player({
            playerAddress: msg.sender,
            lastClaimTime: 0,
            totalRewards: 0
        });
        emit PlayerRegistered(msg.sender);
    }

    function claimTreasure(
        uint256 treasureId,
        externalEuint32 encryptedPlayerLatitude,
        bytes calldata latitudeProof,
        externalEuint32 encryptedPlayerLongitude,
        bytes calldata longitudeProof,
        bytes memory distanceProof
    ) external {
        require(treasures[treasureId].isActive, "Treasure is not active");
        require(!treasures[treasureId].isClaimed, "Treasure already claimed");
        require(players[msg.sender].playerAddress != address(0), "Player not registered");

        euint32 playerLatitude = FHE.fromExternal(encryptedPlayerLatitude, latitudeProof);
        euint32 playerLongitude = FHE.fromExternal(encryptedPlayerLongitude, longitudeProof);

        require(FHE.isInitialized(playerLatitude), "Invalid encrypted player latitude");
        require(FHE.isInitialized(playerLongitude), "Invalid encrypted player longitude");

        FHE.allowThis(playerLatitude);
        FHE.allowThis(playerLongitude);

        bytes32[] memory cts = new bytes32[](4);
        cts[0] = FHE.toBytes32(treasures[treasureId].encryptedLatitude);
        cts[1] = FHE.toBytes32(treasures[treasureId].encryptedLongitude);
        cts[2] = FHE.toBytes32(playerLatitude);
        cts[3] = FHE.toBytes32(playerLongitude);

        FHE.checkSignatures(cts, abi.encode(true), distanceProof);

        treasures[treasureId].isClaimed = true;
        players[msg.sender].lastClaimTime = block.timestamp;
        players[msg.sender].totalRewards += treasures[treasureId].rewardAmount;

        emit TreasureClaimed(treasureId, msg.sender);
    }

    function getTreasure(uint256 treasureId) external view returns (
        euint32 encryptedLatitude,
        euint32 encryptedLongitude,
        uint256 publicHint,
        uint256 rewardAmount,
        address creator,
        bool isActive,
        bool isClaimed
    ) {
        Treasure storage treasure = treasures[treasureId];
        return (
            treasure.encryptedLatitude,
            treasure.encryptedLongitude,
            treasure.publicHint,
            treasure.rewardAmount,
            treasure.creator,
            treasure.isActive,
            treasure.isClaimed
        );
    }

    function getPlayer(address playerAddress) external view returns (
        uint256 lastClaimTime,
        uint256 totalRewards
    ) {
        Player storage player = players[playerAddress];
        return (player.lastClaimTime, player.totalRewards);
    }

    function getTreasureCount() external view returns (uint256) {
        return treasureCount;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


