// backend/aiPythonService.js
// Connects Node.js backend to Python AI microservice
// Manuscript Reference: Section 2.5.1 - AI Core Feature

const axios = require('axios');

class AIPythonService {
    constructor() {
        // Python AI service runs on port 5000
        this.aiServiceUrl = 'http://127.0.0.1:5000';
        this.fallbackMode = false;
    }

    /**
     * Call Python AI model to predict trust score
     * Uses Random Forest Classifier trained on RFM data
     */
    async predictTrustScore(debtorData) {
        try {
            console.log('🤖 Calling Python AI service...');
            
            const response = await axios.post(`${this.aiServiceUrl}/predict`, {
                total_borrowed: parseFloat(debtorData.total_borrowed) || 0,
                total_repaid: parseFloat(debtorData.total_repaid) || 0,
                active_debts: parseInt(debtorData.active_debts) || 0,
                completed_debts: parseInt(debtorData.completed_debts) || 0,
                on_time_payments: parseInt(debtorData.on_time_payments) || 0
            });

            console.log('✅ Python AI response:', response.data);

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
            
            // Fallback to rule-based if Python service fails
            return this.fallbackRuleBased(debtorData);
        }
    }

    /**
     * Convert trust level to numeric score (0-100)
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
     * Fallback rule-based AI (same as your original)
     * Used when Python service is unavailable
     */
    fallbackRuleBased(data) {
        console.log('⚠️ Using fallback rule-based AI');
        
        let score = 50;
        let factors = [];

        // Calculate on-time payment ratio
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

        // Active debt penalty
        if (data.active_debts > 3) {
            score -= 20;
            factors.push('Too many active debts');
        } else if (data.active_debts > 1) {
            score -= 10;
            factors.push('Multiple active debts');
        }

        // Ensure score is within bounds
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
            const response = await axios.get(`${this.aiServiceUrl}/health`);
            this.fallbackMode = false;
            return response.data;
        } catch (error) {
            this.fallbackMode = true;
            return { 
                status: 'offline', 
                message: 'Python AI service not running',
                fallback: 'Using rule-based AI'
            };
        }
    }

    /**
     * Get current mode (Python AI or Fallback)
     */
    getMode() {
        return this.fallbackMode ? 'fallback' : 'python-ai';
    }
}

module.exports = new AIPythonService();