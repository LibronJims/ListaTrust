// backend/aiRiskService.js - UPDATED to use Python AI
// Manuscript Reference: Section 2.5.1 - AI Core Feature

const mysql = require('mysql2/promise');
const aiPythonService = require('./aiPythonService');

class AiRiskService {
    constructor() {
        this.pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'listatrust_db',
            waitForConnections: true,
            connectionLimit: 10
        });
    }

    /**
     * Calculate trust score using Python AI model
     * Falls back to rule-based if Python unavailable
     */
    async calculateTrustScore(debtorId) {
        try {
            // Get debtor's complete history for AI features
            const [debtor] = await this.pool.execute(
                `SELECT 
                    total_borrowed, 
                    total_repaid, 
                    active_debts, 
                    completed_debts, 
                    on_time_payments,
                    first_name,
                    last_name
                 FROM debtors WHERE id = ?`,
                [debtorId]
            );

            if (debtor.length === 0) {
                return this.getDefaultScore(debtorId);
            }

            console.log(`🤖 Calculating AI score for debtor ${debtor[0].first_name} ${debtor[0].last_name}`);
            console.log('   Features:', {
                total_borrowed: debtor[0].total_borrowed,
                total_repaid: debtor[0].total_repaid,
                active_debts: debtor[0].active_debts,
                completed_debts: debtor[0].completed_debts,
                on_time_payments: debtor[0].on_time_payments
            });

            // Call Python AI service
            const aiResult = await aiPythonService.predictTrustScore(debtor[0]);
            
            // Update database with AI result
            await this.pool.execute(
                `UPDATE debtors 
                 SET trust_score = ?, trust_level = ? 
                 WHERE id = ?`,
                [aiResult.score, aiResult.level, debtorId]
            );

            console.log(`✅ AI Result: ${aiResult.level} (${aiResult.score}) - ${aiResult.model}`);

            return {
                debtor_id: debtorId,
                score: aiResult.score,
                level: aiResult.level,
                confidence: aiResult.confidence || 90,
                factors: aiResult.factors,
                model: aiResult.model
            };

        } catch (error) {
            console.error('❌ AI calculation error:', error);
            return this.getDefaultScore(debtorId);
        }
    }

    /**
     * Update debtor's trust score (triggered after payments)
     */
    async updateDebtorTrustScore(debtorId) {
        return await this.calculateTrustScore(debtorId);
    }

    /**
     * Recalculate scores for ALL debtors in a store
     */
    async recalculateStoreScores(storeId) {
        console.log(`🔄 Recalculating AI scores for store ${storeId}...`);
        
        const [debtors] = await this.pool.execute(
            'SELECT id FROM debtors WHERE store_id = ?',
            [storeId]
        );

        const results = [];
        let pythonSuccess = 0;
        let fallbackCount = 0;

        for (const debtor of debtors) {
            const score = await this.calculateTrustScore(debtor.id);
            results.push(score);
            
            if (score.model.includes('Python')) {
                pythonSuccess++;
            } else {
                fallbackCount++;
            }
        }

        const mode = await aiPythonService.getMode();
        
        console.log(`✅ Recalculated ${results.length} debtors`);
        console.log(`   - Python AI: ${pythonSuccess}`);
        console.log(`   - Fallback: ${fallbackCount}`);
        console.log(`   - Mode: ${mode}`);

        return results;
    }

    /**
     * Get risk summary for dashboard
     */
async getStoreRiskSummary(storeId) {
    const [stats] = await this.pool.execute(
        `SELECT 
            COUNT(*) as total_debtors,
            SUM(CASE WHEN trust_level = 'HIGH' THEN 1 ELSE 0 END) as high_count,
            SUM(CASE WHEN trust_level = 'MEDIUM' THEN 1 ELSE 0 END) as medium_count,
            SUM(CASE WHEN trust_level = 'LOW' THEN 1 ELSE 0 END) as low_count,
            AVG(trust_score) as average_score
         FROM debtors 
         WHERE store_id = ?`,
        [storeId]
    );

    // Force a fresh health check
    const aiHealth = await aiPythonService.healthCheck();
    console.log('📊 AI Health Check Result:', aiHealth);
    
    return {
        ...stats[0],
        ai_service: aiHealth.status === 'AI Service is running' ? 'online' : 'offline',
        ai_mode: await aiPythonService.getMode()
    };
}

    /**
     * Default score when debtor not found
     */
    getDefaultScore(debtorId = null) {
        return {
            debtor_id: debtorId,
            score: 50,
            level: 'MEDIUM',
            confidence: 0,
            factors: ['New debtor - insufficient data'],
            model: 'Default'
        };
    }
}

module.exports = new AiRiskService();