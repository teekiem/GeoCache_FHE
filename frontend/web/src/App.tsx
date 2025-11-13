import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface TreasureData {
  id: string;
  name: string;
  encryptedLocation: string;
  hint: string;
  reward: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface TreasureStats {
  totalTreasures: number;
  verifiedTreasures: number;
  avgDistance: number;
  recentTreasures: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [treasures, setTreasures] = useState<TreasureData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingTreasure, setCreatingTreasure] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newTreasureData, setNewTreasureData] = useState({ name: "", location: "", hint: "", reward: "" });
  const [selectedTreasure, setSelectedTreasure] = useState<TreasureData | null>(null);
  const [decryptedLocation, setDecryptedLocation] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [userHistory, setUserHistory] = useState<string[]>([]);
  const [currentLocation, setCurrentLocation] = useState<{lat: number, lng: number} | null>(null);
  const [distanceToTreasure, setDistanceToTreasure] = useState<number | null>(null);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const treasuresList: TreasureData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          treasuresList.push({
            id: businessId,
            name: businessData.name,
            encryptedLocation: businessId,
            hint: businessData.description,
            reward: "Unknown",
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading treasure data:', e);
        }
      }
      
      setTreasures(treasuresList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load treasures" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createTreasure = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingTreasure(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating treasure with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      
      const locationValue = parseInt(newTreasureData.location) || 0;
      const businessId = `treasure-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, locationValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newTreasureData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newTreasureData.reward) || 0,
        0,
        newTreasureData.hint
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Treasure created!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewTreasureData({ name: "", location: "", hint: "", reward: "" });
      addUserHistory(`Created treasure: ${newTreasureData.name}`);
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingTreasure(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Location already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying location..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      addUserHistory(`Decrypted treasure: ${businessId}`);
      setTransactionStatus({ visible: true, status: "success", message: "Location verified!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Location already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        addUserHistory("Checked contract availability");
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const addUserHistory = (action: string) => {
    setUserHistory(prev => [action, ...prev.slice(0, 9)]);
  };

  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        position => {
          const { latitude, longitude } = position.coords;
          setCurrentLocation({ lat: latitude, lng: longitude });
          addUserHistory("Fetched current location");
        },
        error => {
          console.error("Error getting location:", error);
          setTransactionStatus({ visible: true, status: "error", message: "Location access denied" });
          setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
        }
      );
    } else {
      setTransactionStatus({ visible: true, status: "error", message: "Geolocation not supported" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const calculateDistance = (treasureLocation: number) => {
    if (!currentLocation || !decryptedLocation) return;
    
    const treasureLat = Math.floor(treasureLocation / 10000);
    const treasureLng = treasureLocation % 10000;
    
    const latDiff = Math.abs(currentLocation.lat - treasureLat);
    const lngDiff = Math.abs(currentLocation.lng - treasureLng);
    
    const distance = Math.sqrt(Math.pow(latDiff, 2) + Math.pow(lngDiff, 2));
    setDistanceToTreasure(distance);
    addUserHistory(`Calculated distance to treasure: ${distance.toFixed(2)} km`);
  };

  const renderStats = (): TreasureStats => {
    const totalTreasures = treasures.length;
    const verifiedTreasures = treasures.filter(t => t.isVerified).length;
    const recentTreasures = treasures.filter(t => 
      Date.now()/1000 - t.timestamp < 60 * 60 * 24 * 7
    ).length;

    return {
      totalTreasures,
      verifiedTreasures,
      avgDistance: 0,
      recentTreasures
    };
  };

  const renderDashboard = (stats: TreasureStats) => {
    return (
      <div className="dashboard-panels">
        <div className="panel wood-panel">
          <h3>Total Treasures</h3>
          <div className="stat-value">{stats.totalTreasures}</div>
          <div className="stat-trend">+{stats.recentTreasures} this week</div>
        </div>
        
        <div className="panel wood-panel">
          <h3>Verified Locations</h3>
          <div className="stat-value">{stats.verifiedTreasures}/{stats.totalTreasures}</div>
          <div className="stat-trend">FHE Verified</div>
        </div>
        
        <div className="panel wood-panel">
          <h3>Your Location</h3>
          {currentLocation ? (
            <div className="location-data">
              <div>Lat: {currentLocation.lat.toFixed(4)}</div>
              <div>Lng: {currentLocation.lng.toFixed(4)}</div>
            </div>
          ) : (
            <button className="location-btn" onClick={getCurrentLocation}>
              Get Location
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderTreasureMap = () => {
    return (
      <div className="treasure-map">
        <div className="map-overlay">
          <div className="map-center"></div>
          {treasures.map((treasure, index) => (
            <div 
              key={index} 
              className={`treasure-marker ${selectedTreasure?.id === treasure.id ? "selected" : ""}`}
              onClick={() => setSelectedTreasure(treasure)}
            >
              <div className="marker-icon">🗺️</div>
              <div className="marker-name">{treasure.name}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderUserHistory = () => {
    return (
      <div className="history-panel wood-panel">
        <h3>Your Activity</h3>
        <div className="history-list">
          {userHistory.length === 0 ? (
            <div className="no-history">No activity yet</div>
          ) : (
            userHistory.map((item, index) => (
              <div key={index} className="history-item">
                {item}
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Private Geocaching 🔐</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🗺️</div>
            <h2>Connect Your Wallet to Explore</h2>
            <p>Connect your wallet to start the encrypted treasure hunt experience.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will initialize</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start your treasure hunt</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption...</p>
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted treasures...</p>
    </div>
  );

  const stats = renderStats();

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Private Geocaching 🔐</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + Hide Treasure
          </button>
          <button 
            onClick={checkAvailability}
            className="check-btn"
          >
            Check Availability
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Treasure Hunt Dashboard</h2>
          {renderDashboard(stats)}
        </div>
        
        <div className="map-section">
          <h2>Treasure Map</h2>
          {renderTreasureMap()}
        </div>
        
        <div className="history-section">
          {renderUserHistory()}
        </div>
        
        <div className="treasures-section">
          <div className="section-header">
            <h2>Hidden Treasures</h2>
            <div className="header-actions">
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="treasures-list">
            {treasures.length === 0 ? (
              <div className="no-treasures">
                <p>No treasures found</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Hide First Treasure
                </button>
              </div>
            ) : treasures.map((treasure, index) => (
              <div 
                className={`treasure-item ${selectedTreasure?.id === treasure.id ? "selected" : ""} ${treasure.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedTreasure(treasure)}
              >
                <div className="treasure-title">{treasure.name}</div>
                <div className="treasure-meta">
                  <span>Reward: {treasure.publicValue1}</span>
                  <span>Hidden: {new Date(treasure.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="treasure-status">
                  Status: {treasure.isVerified ? "✅ Location Verified" : "🔓 Encrypted Location"}
                </div>
                <div className="treasure-creator">Creator: {treasure.creator.substring(0, 6)}...{treasure.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateTreasure 
          onSubmit={createTreasure} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingTreasure} 
          treasureData={newTreasureData} 
          setTreasureData={setNewTreasureData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedTreasure && (
        <TreasureDetailModal 
          treasure={selectedTreasure} 
          onClose={() => { 
            setSelectedTreasure(null); 
            setDecryptedLocation(null);
            setDistanceToTreasure(null);
          }} 
          decryptedLocation={decryptedLocation} 
          setDecryptedLocation={setDecryptedLocation}
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedTreasure.id)}
          distance={distanceToTreasure}
          calculateDistance={calculateDistance}
          currentLocation={currentLocation}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateTreasure: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  treasureData: any;
  setTreasureData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, treasureData, setTreasureData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setTreasureData({ ...treasureData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-treasure-modal">
        <div className="modal-header">
          <h2>Hide New Treasure</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Location will be encrypted with Zama FHE 🔐 (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Treasure Name *</label>
            <input 
              type="text" 
              name="name" 
              value={treasureData.name} 
              onChange={handleChange} 
              placeholder="Enter treasure name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Location Code (Integer only) *</label>
            <input 
              type="number" 
              name="location" 
              value={treasureData.location} 
              onChange={handleChange} 
              placeholder="Enter location code..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Hint *</label>
            <textarea 
              name="hint" 
              value={treasureData.hint} 
              onChange={handleChange} 
              placeholder="Enter hint for treasure hunters..." 
            />
          </div>
          
          <div className="form-group">
            <label>Reward *</label>
            <input 
              type="number" 
              min="1" 
              name="reward" 
              value={treasureData.reward} 
              onChange={handleChange} 
              placeholder="Enter reward amount..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !treasureData.name || !treasureData.location || !treasureData.hint || !treasureData.reward} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Hiding..." : "Hide Treasure"}
          </button>
        </div>
      </div>
    </div>
  );
};

const TreasureDetailModal: React.FC<{
  treasure: TreasureData;
  onClose: () => void;
  decryptedLocation: number | null;
  setDecryptedLocation: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  distance: number | null;
  calculateDistance: (location: number) => void;
  currentLocation: {lat: number, lng: number} | null;
}> = ({ treasure, onClose, decryptedLocation, setDecryptedLocation, isDecrypting, decryptData, distance, calculateDistance, currentLocation }) => {
  const handleDecrypt = async () => {
    if (decryptedLocation !== null) { 
      setDecryptedLocation(null); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedLocation(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="treasure-detail-modal">
        <div className="modal-header">
          <h2>Treasure Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="treasure-info">
            <div className="info-item">
              <span>Treasure Name:</span>
              <strong>{treasure.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{treasure.creator.substring(0, 6)}...{treasure.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Hidden:</span>
              <strong>{new Date(treasure.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Reward:</span>
              <strong>{treasure.publicValue1}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Location</h3>
            
            <div className="data-row">
              <div className="data-label">Location Code:</div>
              <div className="data-value">
                {treasure.isVerified && treasure.decryptedValue ? 
                  `${treasure.decryptedValue} (Verified)` : 
                  decryptedLocation !== null ? 
                  `${decryptedLocation} (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(treasure.isVerified || decryptedLocation !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Decrypting..."
                ) : treasure.isVerified ? (
                  "✅ Verified"
                ) : decryptedLocation !== null ? (
                  "🔄 Re-decrypt"
                ) : (
                  "🔓 Decrypt Location"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 Location Protection</strong>
                <p>Actual location is encrypted on-chain. Decrypt to reveal the location code.</p>
              </div>
            </div>
          </div>
          
          {(treasure.isVerified || decryptedLocation !== null) && (
            <div className="distance-section">
              <h3>Distance Calculation</h3>
              
              {currentLocation ? (
                <div className="location-data">
                  <div>Your Location: {currentLocation.lat.toFixed(4)}, {currentLocation.lng.toFixed(4)}</div>
                  <div>Treasure Code: {decryptedLocation}</div>
                </div>
              ) : (
                <button className="location-btn" onClick={() => navigator.geolocation.getCurrentPosition(
                  position => {
                    const { latitude, longitude } = position.coords;
                    setCurrentLocation({ lat: latitude, lng: longitude });
                  },
                  error => console.error(error)
                )}>
                  Get Your Location
                </button>
              )}
              
              {currentLocation && (
                <div className="distance-action">
                  <button 
                    className="calculate-btn"
                    onClick={() => calculateDistance(decryptedLocation || 0)}
                    disabled={!decryptedLocation}
                  >
                    Calculate Distance
                  </button>
                  
                  {distance !== null && (
                    <div className="distance-result">
                      Distance to treasure: <strong>{distance.toFixed(2)} km</strong>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          
          <div className="hint-section">
            <h3>Treasure Hint</h3>
            <div className="hint-content">{treasure.hint}</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!treasure.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


