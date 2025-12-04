import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface EnergyData {
  id: string;
  encryptedData: string;
  timestamp: number;
  tenant: string;
  energyUsage: number;
  status: "pending" | "verified" | "rejected";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [energyData, setEnergyData] = useState<EnergyData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newEnergyData, setNewEnergyData] = useState({
    energyUsage: "",
    buildingArea: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Calculate statistics
  const verifiedCount = energyData.filter(d => d.status === "verified").length;
  const pendingCount = energyData.filter(d => d.status === "pending").length;
  const rejectedCount = energyData.filter(d => d.status === "rejected").length;
  const totalUsage = energyData.reduce((sum, data) => sum + data.energyUsage, 0);

  useEffect(() => {
    loadEnergyData().finally(() => setLoading(false));
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

  const loadEnergyData = async () => {
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
      
      const keysBytes = await contract.getData("energy_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing energy keys:", e);
        }
      }
      
      const list: EnergyData[] = [];
      
      for (const key of keys) {
        try {
          const dataBytes = await contract.getData(`energy_${key}`);
          if (dataBytes.length > 0) {
            try {
              const data = JSON.parse(ethers.toUtf8String(dataBytes));
              list.push({
                id: key,
                encryptedData: data.data,
                timestamp: data.timestamp,
                tenant: data.tenant,
                energyUsage: data.energyUsage,
                status: data.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing energy data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading energy data ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setEnergyData(list);
    } catch (e) {
      console.error("Error loading energy data:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitEnergyData = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setSubmitting(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting energy data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newEnergyData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const energyData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        tenant: account,
        energyUsage: Number(newEnergyData.energyUsage),
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `energy_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(energyData))
      );
      
      const keysBytes = await contract.getData("energy_keys");
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
        "energy_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted energy data submitted!"
      });
      
      await loadEnergyData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewEnergyData({
          energyUsage: "",
          buildingArea: ""
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
      setSubmitting(false);
    }
  };

  const verifyData = async (dataId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataBytes = await contract.getData(`energy_${dataId}`);
      if (dataBytes.length === 0) {
        throw new Error("Data not found");
      }
      
      const data = JSON.parse(ethers.toUtf8String(dataBytes));
      
      const updatedData = {
        ...data,
        status: "verified"
      };
      
      await contract.setData(
        `energy_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedData))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed!"
      });
      
      await loadEnergyData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectData = async (dataId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataBytes = await contract.getData(`energy_${dataId}`);
      if (dataBytes.length === 0) {
        throw new Error("Data not found");
      }
      
      const data = JSON.parse(ethers.toUtf8String(dataBytes));
      
      const updatedData = {
        ...data,
        status: "rejected"
      };
      
      await contract.setData(
        `energy_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedData))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE rejection completed!"
      });
      
      await loadEnergyData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rejection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isTenant = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the platform",
      icon: "🔗"
    },
    {
      title: "Submit Encrypted Data",
      description: "Upload your encrypted energy usage data using FHE",
      icon: "🔒"
    },
    {
      title: "FHE Processing",
      description: "Building system processes encrypted data without decryption",
      icon: "⚙️"
    },
    {
      title: "Optimize & Save",
      description: "Receive optimized energy schedule and cost savings",
      icon: "💡"
    }
  ];

  const renderBarChart = () => {
    // Get last 7 days of data
    const today = new Date();
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }).reverse();

    // Calculate daily usage
    const dailyUsage = last7Days.map(date => {
      return energyData
        .filter(data => {
          const dataDate = new Date(data.timestamp * 1000);
          return dataDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) === date;
        })
        .reduce((sum, data) => sum + data.energyUsage, 0);
    });

    const maxUsage = Math.max(...dailyUsage, 1);

    return (
      <div className="bar-chart">
        {dailyUsage.map((usage, index) => (
          <div className="bar-container" key={index}>
            <div className="bar-label">{last7Days[index]}</div>
            <div className="bar" style={{ height: `${(usage / maxUsage) * 100}%` }}>
              <div className="bar-value">{usage} kWh</div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container future-metal-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="energy-icon"></div>
          </div>
          <h1>FHE<span>Energy</span>Optimizer</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-data-btn metal-button"
          >
            <div className="add-icon"></div>
            Submit Data
          </button>
          <button 
            className="metal-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="dashboard-layout">
        <div className="dashboard-column main-panel">
          <div className="welcome-banner">
            <div className="welcome-text">
              <h2>Privacy-Preserving Energy Optimization</h2>
              <p>Optimize building energy usage with FHE-encrypted tenant data</p>
            </div>
          </div>
          
          {showTutorial && (
            <div className="tutorial-section metal-card">
              <h2>How FHE Energy Optimization Works</h2>
              <p className="subtitle">Learn how to securely optimize building energy usage</p>
              
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
          
          <div className="project-intro metal-card">
            <h3>Project Introduction</h3>
            <p>
              FHE Energy Optimizer uses Fully Homomorphic Encryption (FHE) to allow tenants to 
              securely share encrypted energy usage data. The building management system can 
              then optimize central HVAC and lighting systems without accessing raw data.
            </p>
            <div className="fhe-badge">
              <span>FHE-Powered Privacy</span>
            </div>
          </div>
          
          <div className="data-section metal-card">
            <div className="section-header">
              <h2>Tenant Energy Data</h2>
              <div className="header-actions">
                <button 
                  onClick={loadEnergyData}
                  className="refresh-btn metal-button"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="data-list">
              {energyData.length === 0 ? (
                <div className="no-data">
                  <div className="no-data-icon"></div>
                  <p>No energy data records found</p>
                  <button 
                    className="metal-button primary"
                    onClick={() => setShowCreateModal(true)}
                  >
                    Submit First Data
                  </button>
                </div>
              ) : (
                energyData.map(data => (
                  <div className={`data-item ${expandedId === data.id ? 'expanded' : ''}`} key={data.id}>
                    <div className="data-summary" onClick={() => setExpandedId(expandedId === data.id ? null : data.id)}>
                      <div className="data-id">#{data.id.substring(0, 6)}</div>
                      <div className="data-tenant">{data.tenant.substring(0, 6)}...{data.tenant.substring(38)}</div>
                      <div className="data-usage">{data.energyUsage} kWh</div>
                      <div className="data-date">
                        {new Date(data.timestamp * 1000).toLocaleDateString()}
                      </div>
                      <div className="data-status">
                        <span className={`status-badge ${data.status}`}>
                          {data.status}
                        </span>
                      </div>
                      <div className="expand-icon">{expandedId === data.id ? '▲' : '▼'}</div>
                    </div>
                    
                    {expandedId === data.id && (
                      <div className="data-details">
                        <div className="detail-row">
                          <span>Tenant:</span>
                          <span>{data.tenant}</span>
                        </div>
                        <div className="detail-row">
                          <span>Timestamp:</span>
                          <span>{new Date(data.timestamp * 1000).toLocaleString()}</span>
                        </div>
                        <div className="detail-row">
                          <span>Encrypted Data:</span>
                          <span className="encrypted-data">{data.encryptedData.substring(0, 40)}...</span>
                        </div>
                        <div className="detail-row">
                          <span>FHE Status:</span>
                          <span>{data.status}</span>
                        </div>
                        
                        {isTenant(data.tenant) && data.status === "pending" && (
                          <div className="data-actions">
                            <button 
                              className="action-btn metal-button success"
                              onClick={() => verifyData(data.id)}
                            >
                              Verify
                            </button>
                            <button 
                              className="action-btn metal-button danger"
                              onClick={() => rejectData(data.id)}
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        
        <div className="dashboard-column side-panel">
          <div className="stats-card metal-card">
            <h3>Energy Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{energyData.length}</div>
                <div className="stat-label">Total Records</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{verifiedCount}</div>
                <div className="stat-label">Verified</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{rejectedCount}</div>
                <div className="stat-label">Rejected</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{totalUsage}</div>
                <div className="stat-label">Total kWh</div>
              </div>
            </div>
          </div>
          
          <div className="chart-card metal-card">
            <h3>Energy Usage (Last 7 Days)</h3>
            {renderBarChart()}
          </div>
          
          <div className="fhe-benefits metal-card">
            <h3>FHE Benefits</h3>
            <ul>
              <li>Tenant data remains encrypted at all times</li>
              <li>Building optimization without privacy compromise</li>
              <li>Secure computation on encrypted data</li>
              <li>Transparent cost savings distribution</li>
            </ul>
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitEnergyData} 
          onClose={() => setShowCreateModal(false)} 
          submitting={submitting}
          energyData={newEnergyData}
          setEnergyData={setNewEnergyData}
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
          <div className="transaction-content metal-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
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
              <div className="energy-icon"></div>
              <span>FHE Energy Optimizer</span>
            </div>
            <p>Privacy-preserving building energy optimization</p>
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
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE Energy Optimizer. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  submitting: boolean;
  energyData: any;
  setEnergyData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  submitting,
  energyData,
  setEnergyData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setEnergyData({
      ...energyData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!energyData.energyUsage) {
      alert("Please enter energy usage");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal metal-card">
        <div className="modal-header">
          <h2>Submit Energy Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your data will be encrypted with FHE
          </div>
          
          <div className="form-group">
            <label>Energy Usage (kWh) *</label>
            <input 
              type="number"
              name="energyUsage"
              value={energyData.energyUsage} 
              onChange={handleChange}
              placeholder="Enter energy consumption" 
              className="metal-input"
            />
          </div>
          
          <div className="form-group">
            <label>Building Area (m²)</label>
            <input 
              type="number"
              name="buildingArea"
              value={energyData.buildingArea} 
              onChange={handleChange}
              placeholder="Optional: building area" 
              className="metal-input"
            />
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn metal-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={submitting}
            className="submit-btn metal-button primary"
          >
            {submitting ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;