// backend/aiPythonService.js

const axios = require('axios');

class AIPythonService {
    constructor() {
        this.aiServiceUrl = 'http://127.0.0.1:5000';
        this.fallbackMode = false;
        this.lastCheck = null;
    }

    /**
     * Call Python AI model to predict trust score
     */
    async predictTrustScore(debtorData) {
        try {
            console.log('🤖 Calling Python AI service...');
            console.log('   URL:', `${this.aiServiceUrl}/predict`);
            console.log('   Data:', debtorData);
            
            const response = await axios.post(`${this.aiServiceUrl}/predict`, {
                total_borrowed: parseFloat(debtorData.total_borrowed) || 0,
                total_repaid: parseFloat(debtorData.total_repaid) || 0,
                active_debts: parseInt(debtorData.active_debts) || 0,
                completed_debts: parseInt(debtorData.completed_debts) || 0,
                on_time_payments: parseInt(debtorData.on_time_payments) || 0
            }, {
                timeout: 5000 // 5 second timeout
            });

            console.log('✅ Python AI response:', response.data);

            this.fallbackMode = false;
            this.lastCheck = 'online';

            return {
                score: this.mapTrustLevelToScore(response.data.trust_level),
                level: response.data.trust_level,
                confidence: response.data.confidence,
                factors: [`AI Model: ${response.data.message}`],
                model: 'Random Forest Classifier (Python)'
            };

        } catch (error) {
            console.error('❌ Python AI service error:', error.message);
            this.fallbackMode = true;
            this.lastCheck = 'offline';
            
            return this.fallbackRuleBased(debtorData);
        }
    }

    /**
     * Convert trust level to numeric score
     */
    mapTrustLevelToScore(level) {
        switch(level) {
            case 'HIGH': return 85;
            case 'MEDIUM': return 50;
            case 'LOW': return 20;
            default: return 50;
        }
    }

    /**
     * Fallback rule-based AI
     */
    fallbackRuleBased(data) {
        console.log('⚠️ Using fallback rule-based AI');
        
        let score = 50;
        let factors = [];

        if (data.completed_debts > 0) {
            const onTimeRatio = data.on_time_payments / data.completed_debts;
            
            if (onTimeRatio >= 0.8) {
                score = 85;
                factors.push('Good payment history');
            } else if (onTimeRatio >= 0.5) {
                score = 60;
                factors.push('Average payment history');
            } else {
                score = 30;
                factors.push('Poor payment history');
            }
        }

        if (data.active_debts > 3) {
            score -= 20;
            factors.push('Too many active debts');
        } else if (data.active_debts > 1) {
            score -= 10;
            factors.push('Multiple active debts');
        }

        score = Math.max(0, Math.min(100, score));

        return {
            score: score,
            level: score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW',
            confidence: 85,
            factors: factors.length ? factors : ['Insufficient data'],
            model: 'Fallback Rule-Based',
            note: 'Python AI service unavailable'
        };
    }

    /**
     * Check if Python AI service is running
     */
    async healthCheck() {
        try {
            console.log('🔍 Checking Python AI health...');
            
            const response = await axios.get(`${this.aiServiceUrl}/health`, {
                timeout: 3000
            });
            
            console.log('✅ Python AI health check response:', response.data);
            
            if (response.data.status === 'AI Service is running') {
                this.fallbackMode = false;
                this.lastCheck = 'online';
                return { 
                    status: 'AI Service is running', 
                    model_loaded: true,
                    timestamp: new Date().toISOString()
                };
            } else {
                this.fallbackMode = true;
                this.lastCheck = 'offline';
                return { 
                    status: 'offline', 
                    message: 'Python AI service not responding',
                    fallback: 'Using rule-based AI'
                };
            }
        } catch (error) {
            console.error('❌ Python AI health check failed:', error.message);
            this.fallbackMode = true;
            this.lastCheck = 'offline';
            return { 
                status: 'offline', 
                message: error.message,
                fallback: 'Using rule-based AI'
            };
        }
    }

    /**
     * Get current mode
     */
    getMode() {
        return this.fallbackMode ? 'fallback' : 'python-ai';
    }

    /**
     * Test direct connection
     */
    async testConnection() {
        try {
            const response = await axios.get(`${this.aiServiceUrl}/test`, {
                timeout: 3000
            });
            return { success: true, data: response.data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

module.exports = new AIPythonService();