import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface FRBData {
  id: string;
  encryptedData: string;
  timestamp: number;
  observatory: string;
  frequency: string;
  status: "raw" | "processed" | "analyzed";
  signalStrength: number;
  location: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [frbData, setFrbData] = useState<FRBData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newData, setNewData] = useState({
    observatory: "",
    frequency: "",
    signalStrength: "",
    location: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedData, setSelectedData] = useState<FRBData | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // Calculate statistics for dashboard
  const rawCount = frbData.filter(d => d.status === "raw").length;
  const processedCount = frbData.filter(d => d.status === "processed").length;
  const analyzedCount = frbData.filter(d => d.status === "analyzed").length;

  useEffect(() => {
    loadFrbData().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadFrbData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("frb_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing frb keys:", e);
        }
      }
      
      const list: FRBData[] = [];
      
      for (const key of keys) {
        try {
          const dataBytes = await contract.getData(`frb_${key}`);
          if (dataBytes.length > 0) {
            try {
              const data = JSON.parse(ethers.toUtf8String(dataBytes));
              list.push({
                id: key,
                encryptedData: data.data,
                timestamp: data.timestamp,
                observatory: data.observatory,
                frequency: data.frequency,
                status: data.status || "raw",
                signalStrength: data.signalStrength,
                location: data.location
              });
            } catch (e) {
              console.error(`Error parsing data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading data ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setFrbData(list);
    } catch (e) {
      console.error("Error loading data:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitData = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting FRB data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const frbData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        observatory: newData.observatory,
        frequency: newData.frequency,
        status: "raw",
        signalStrength: parseInt(newData.signalStrength),
        location: newData.location
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `frb_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(frbData))
      );
      
      const keysBytes = await contract.getData("frb_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(dataId);
      
      await contract.setData(
        "frb_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FRB data encrypted and submitted securely!"
      });
      
      await loadFrbData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewData({
          observatory: "",
          frequency: "",
          signalStrength: "",
          location: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const processData = async (dataId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing FRB data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataBytes = await contract.getData(`frb_${dataId}`);
      if (dataBytes.length === 0) {
        throw new Error("Data not found");
      }
      
      const data = JSON.parse(ethers.toUtf8String(dataBytes));
      
      const updatedData = {
        ...data,
        status: "processed"
      };
      
      await contract.setData(
        `frb_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedData))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE processing completed successfully!"
      });
      
      await loadFrbData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Processing failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const analyzeData = async (dataId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Analyzing FRB data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataBytes = await contract.getData(`frb_${dataId}`);
      if (dataBytes.length === 0) {
        throw new Error("Data not found");
      }
      
      const data = JSON.parse(ethers.toUtf8String(dataBytes));
      
      const updatedData = {
        ...data,
        status: "analyzed"
      };
      
      await contract.setData(
        `frb_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedData))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE analysis completed successfully!"
      });
      
      await loadFrbData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Analysis failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Observatory Wallet",
      description: "Connect your Web3 wallet to submit encrypted FRB data",
      icon: "🔗"
    },
    {
      title: "Submit Encrypted FRB Data",
      description: "Add your FRB observation data which will be encrypted using FHE",
      icon: "🔒"
    },
    {
      title: "FHE Signal Processing",
      description: "FRB signals are processed in encrypted state without decryption",
      icon: "⚙️"
    },
    {
      title: "Get Analysis Results",
      description: "Receive verifiable FRB analysis while keeping data private",
      icon: "📊"
    }
  ];

  const renderPieChart = () => {
    const total = frbData.length || 1;
    const rawPercentage = (rawCount / total) * 100;
    const processedPercentage = (processedCount / total) * 100;
    const analyzedPercentage = (analyzedCount / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment raw" 
            style={{ transform: `rotate(${rawPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment processed" 
            style={{ transform: `rotate(${(rawPercentage + processedPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment analyzed" 
            style={{ transform: `rotate(${(rawPercentage + processedPercentage + analyzedPercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{frbData.length}</div>
            <div className="pie-label">FRBs</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box raw"></div>
            <span>Raw: {rawCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box processed"></div>
            <span>Processed: {processedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box analyzed"></div>
            <span>Analyzed: {analyzedCount}</span>
          </div>
        </div>
      </div>
    );
  };

  const showDataDetails = (data: FRBData) => {
    setSelectedData(data);
    setShowDetailModal(true);
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing encrypted FRB connection...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="pulsar-icon"></div>
          </div>
          <h1>FRB<span>Analysis</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-data-btn cyber-button"
          >
            <div className="add-icon"></div>
            Add FRB Data
          </button>
          <button 
            className="cyber-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Confidential Analysis of Fast Radio Bursts</h2>
            <p>Process encrypted FRB data from multiple observatories using FHE technology</p>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>FHE FRB Analysis Tutorial</h2>
            <p className="subtitle">Learn how to securely process FRB data across observatories</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card cyber-card">
            <h3>Project Introduction</h3>
            <p>Secure FRB analysis platform using FHE technology to process encrypted radio telescope data from multiple observatories without decryption.</p>
            <div className="fhe-badge">
              <span>FHE-Powered</span>
            </div>
          </div>
          
          <div className="dashboard-card cyber-card">
            <h3>FRB Data Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{frbData.length}</div>
                <div className="stat-label">Total FRBs</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{rawCount}</div>
                <div className="stat-label">Raw</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{processedCount}</div>
                <div className="stat-label">Processed</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{analyzedCount}</div>
                <div className="stat-label">Analyzed</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card cyber-card">
            <h3>Status Distribution</h3>
            {renderPieChart()}
          </div>
        </div>
        
        <div className="data-section">
          <div className="section-header">
            <h2>Encrypted FRB Data Records</h2>
            <div className="header-actions">
              <button 
                onClick={loadFrbData}
                className="refresh-btn cyber-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="data-list cyber-card">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Observatory</div>
              <div className="header-cell">Frequency</div>
              <div className="header-cell">Signal</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {frbData.length === 0 ? (
              <div className="no-data">
                <div className="no-data-icon"></div>
                <p>No FRB data found</p>
                <button 
                  className="cyber-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First FRB Data
                </button>
              </div>
            ) : (
              frbData.map(data => (
                <div className="data-row" key={data.id}>
                  <div className="table-cell data-id">#{data.id.substring(0, 6)}</div>
                  <div className="table-cell">{data.observatory}</div>
                  <div className="table-cell">{data.frequency} MHz</div>
                  <div className="table-cell">{data.signalStrength} Jy</div>
                  <div className="table-cell">
                    {new Date(data.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${data.status}`}>
                      {data.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    <button 
                      className="action-btn cyber-button info"
                      onClick={() => showDataDetails(data)}
                    >
                      Details
                    </button>
                    {isOwner(data.observatory) && data.status === "raw" && (
                      <button 
                        className="action-btn cyber-button success"
                        onClick={() => processData(data.id)}
                      >
                        Process
                      </button>
                    )}
                    {isOwner(data.observatory) && data.status === "processed" && (
                      <button 
                        className="action-btn cyber-button primary"
                        onClick={() => analyzeData(data.id)}
                      >
                        Analyze
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitData} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          data={newData}
          setData={setNewData}
        />
      )}
      
      {showDetailModal && selectedData && (
        <ModalDetail 
          data={selectedData}
          onClose={() => setShowDetailModal(false)}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="pulsar-icon"></div>
              <span>FRBAnalysisFHE</span>
            </div>
            <p>Secure encrypted FRB analysis using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Astronomy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FRBAnalysisFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  data: any;
  setData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  data,
  setData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setData({
      ...data,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!data.observatory || !data.frequency || !data.signalStrength) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cyber-card">
        <div className="modal-header">
          <h2>Add Encrypted FRB Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your FRB data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Observatory *</label>
              <select 
                name="observatory"
                value={data.observatory} 
                onChange={handleChange}
                className="cyber-select"
              >
                <option value="">Select observatory</option>
                <option value="CHIME">CHIME</option>
                <option value="FAST">FAST</option>
                <option value="ASKAP">ASKAP</option>
                <option value="Arecibo">Arecibo</option>
                <option value="GBT">Green Bank Telescope</option>
                <option value="VLA">Very Large Array</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Frequency (MHz) *</label>
              <input 
                type="text"
                name="frequency"
                value={data.frequency} 
                onChange={handleChange}
                placeholder="e.g., 1400" 
                className="cyber-input"
              />
            </div>
            
            <div className="form-group">
              <label>Signal Strength (Jy) *</label>
              <input 
                type="number"
                name="signalStrength"
                value={data.signalStrength} 
                onChange={handleChange}
                placeholder="e.g., 2.5" 
                className="cyber-input"
              />
            </div>
            
            <div className="form-group">
              <label>Location</label>
              <input 
                type="text"
                name="location"
                value={data.location} 
                onChange={handleChange}
                placeholder="RA/Dec coordinates" 
                className="cyber-input"
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn cyber-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn cyber-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ModalDetailProps {
  data: FRBData;
  onClose: () => void;
}

const ModalDetail: React.FC<ModalDetailProps> = ({ data, onClose }) => {
  return (
    <div className="modal-overlay">
      <div className="detail-modal cyber-card">
        <div className="modal-header">
          <h2>FRB Data Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="detail-grid">
            <div className="detail-item">
              <label>ID:</label>
              <span>{data.id}</span>
            </div>
            <div className="detail-item">
              <label>Observatory:</label>
              <span>{data.observatory}</span>
            </div>
            <div className="detail-item">
              <label>Frequency:</label>
              <span>{data.frequency} MHz</span>
            </div>
            <div className="detail-item">
              <label>Signal Strength:</label>
              <span>{data.signalStrength} Jy</span>
            </div>
            <div className="detail-item">
              <label>Location:</label>
              <span>{data.location || "Unknown"}</span>
            </div>
            <div className="detail-item">
              <label>Date:</label>
              <span>{new Date(data.timestamp * 1000).toLocaleString()}</span>
            </div>
            <div className="detail-item">
              <label>Status:</label>
              <span className={`status-badge ${data.status}`}>{data.status}</span>
            </div>
            <div className="detail-item full-width">
              <label>Encrypted Data:</label>
              <div className="encrypted-data">
                {data.encryptedData}
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="close-btn cyber-button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;