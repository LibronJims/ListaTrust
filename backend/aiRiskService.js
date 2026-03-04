// aiRiskService.js - RFM-based trust scoring system
// Matches manuscript Section 2.5.1 and Appendix A.1

const mysql = require('mysql2/promise');

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

    // Calculate RFM (Recency, Frequency, Monetary) scores
    // Based on manuscript: "RFM analysis model to generate dynamic Trust Score"
    async calculateTrustScore(debtorId) {
        try {
            // Get debtor's transaction history
            const [transactions] = await this.pool.execute(
                `SELECT * FROM transactions 
                 WHERE debtor_id = ? 
                 ORDER BY created_at DESC 
                 LIMIT 20`,
                [debtorId]
            );

            if (transactions.length === 0) {
                return {
                    score: 50,
                    level: 'MEDIUM',
                    color: 'Yellow',
                    factors: ['New customer - no history'],
                    debtor_id: debtorId
                };
            }

            // ===== RFM CALCULATIONS =====
            // As specified in manuscript Section 2.2
            
            // 1. RECENCY - How recent was their last payment?
            const lastTransaction = transactions[0];
            const daysSinceLastActivity = this.getDaysSince(lastTransaction.created_at);
            let recencyScore = 100;
            if (daysSinceLastActivity > 30) recencyScore = 30;
            else if (daysSinceLastActivity > 14) recencyScore = 60;
            else if (daysSinceLastActivity > 7) recencyScore = 80;
            
            // 2. FREQUENCY - How often do they borrow/pay?
            const completedTransactions = transactions.filter(t => t.status === 'COMPLETED').length;
            let frequencyScore = Math.min(100, completedTransactions * 10);
            
            // 3. MONETARY - Do they pay on time?
            let onTimeCount = 0;
            let lateCount = 0;
            
            transactions.forEach(t => {
                if (t.status === 'COMPLETED' && t.due_date && t.paid_date) {
                    const dueDate = new Date(t.due_date);
                    const paidDate = new Date(t.paid_date);
                    if (paidDate <= dueDate) {
                        onTimeCount++;
                    } else {
                        lateCount++;
                    }
                }
            });

            const totalPayments = onTimeCount + lateCount;
            let monetaryScore = 50; // Default
            
            if (totalPayments > 0) {
                monetaryScore = (onTimeCount / totalPayments) * 100;
            }

            // 4. ACTIVE DEBTS PENALTY
            const [debtorInfo] = await this.pool.execute(
                'SELECT active_debts, total_borrowed, total_repaid FROM debtors WHERE id = ?',
                [debtorId]
            );

            let activeDebtPenalty = 0;
            if (debtorInfo[0]?.active_debts > 3) {
                activeDebtPenalty = 20; // Too many active debts
            } else if (debtorInfo[0]?.active_debts > 1) {
                activeDebtPenalty = 10;
            }

            // 5. FINAL SCORE (Weighted average - matches manuscript)
            // Recency 30%, Frequency 20%, Monetary 40%, Active Debts 10%
            const finalScore = Math.round(
                (recencyScore * 0.3) +      // Recency 30%
                (frequencyScore * 0.2) +     // Frequency 20%
                (monetaryScore * 0.4) +       // Monetary 40%
                (100 - activeDebtPenalty) * 0.1  // Active debts 10%
            );

            // Determine level and color (for dashboard Red/Yellow/Green)
            let level, color;
            if (finalScore >= 70) {
                level = 'HIGH';
                color = 'Green';
            } else if (finalScore >= 40) {
                level = 'MEDIUM';
                color = 'Yellow';
            } else {
                level = 'LOW';
                color = 'Red';
            }

            // Factors for explainability (matches manuscript's XAI requirement)
            const factors = [];
            if (recencyScore < 50) factors.push('Inactive recently');
            if (frequencyScore < 30) factors.push('Infrequent borrower');
            if (monetaryScore < 50) factors.push('Frequent late payments');
            if (activeDebtPenalty > 0) factors.push('Too many active debts');
            if (factors.length === 0) factors.push('Good payment behavior');

            return {
                debtor_id: debtorId,
                score: finalScore,
                level: level,
                color: color,
                factors: factors,
                components: {
                    recency: recencyScore,
                    frequency: frequencyScore,
                    monetary: monetaryScore,
                    activeDebtPenalty: activeDebtPenalty
                }
            };

        } catch (error) {
            console.error('AI Risk calculation error:', error);
            return {
                score: 50,
                level: 'MEDIUM',
                color: 'Yellow',
                factors: ['Error calculating score'],
                debtor_id: debtorId,
                error: error.message
            };
        }
    }

    // Update trust score in database
    async updateDebtorTrustScore(debtorId) {
        const scoreData = await this.calculateTrustScore(debtorId);
        
        await this.pool.execute(
            `UPDATE debtors 
             SET trust_score = ?, trust_level = ?
             WHERE id = ?`,
            [scoreData.score, scoreData.level, debtorId]
        );

        return scoreData;
    }

    // Recalculate scores for ALL debtors of a store
    async recalculateStoreScores(storeId) {
        const [debtors] = await this.pool.execute(
            'SELECT id FROM debtors WHERE store_id = ?',
            [storeId]
        );

        const results = [];
        for (const debtor of debtors) {
            const score = await this.updateDebtorTrustScore(debtor.id);
            results.push(score);
        }

        return results;
    }

    // Get risk summary for dashboard (matches Figure 1 in manuscript)
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

        return stats[0];
    }

    // Helper: Calculate days since date
    getDaysSince(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diffTime = Math.abs(now - date);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    }
}

module.exports = new AiRiskService();