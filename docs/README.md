# ListaTrust — Decentralized Credit Ledger Platform

> Hybrid web platform to eliminate micro‑credit leakage for sari‑sari stores
> Last updated: February 20, 2026

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![MySQL](https://img.shields.io/badge/MySQL-8.x-blue.svg)](https://www.mysql.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Table of Contents
- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Security Features](#security-features)
- [Development](#development)
- [Deployment](#deployment)

---

## Overview

**ListaTrust** digitizes vulnerable handwritten ledgers used by sari‑sari stores in the Philippines, providing an immutable, transparent system for tracking micro‑credit (`utang`). The platform prevents loss or tampering of credit records through secure authentication, audit logging, and blockchain-ready architecture.

---

## Key Features

### 🔐 Secure Authentication
- Email OTP verification for registration and login
- JWT tokens with 24-hour expiry
- Rate limiting (5 attempts/hour) with account locking
- bcrypt password hashing

### 📊 Store Owner Dashboard
- Complete debtor management (CRUD operations)
- Transaction recording (borrow/pay)
- Automatic trust score calculation based on payment history
- Photo upload for debtors and profile

### 👑 Admin Panel
- User management with role-based access
- Store approval system
- Comprehensive audit logs
- System monitoring

### 🔒 Database Security
- Parameterized queries prevent SQL injection
- Input validation and XSS protection
- Audit logging for all sensitive actions
- Role-based access control (RBAC)

### ⛓️ Blockchain Ready
- Solidity smart contract for immutable debt records
- Ready for Polygon/Ethereum integration
- Hash-based verification system

---

## Architecture
