// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract ListaTrust {
    struct Utang {
        uint id;
        address customer;
        uint amount;
        string items;
        bool paid;
        uint timestamp;
    }
    
    Utang[] public utangList;
    address public owner;
    address public pendingOwner; // VULN #6 FIX
    
    // Security: Track active utang to prevent ID confusion
    mapping(uint => bool) public activeUtang;
    
    // VULN #4 FIX: Customer debt limits
    mapping(address => uint) public customerDebtLimit;
    
    // VULN #5 FIX: Track pending deletions
    mapping(uint => bool) public pendingDelete;
    
    // Events
    event NewUtang(uint id, address customer, uint amount, string items);
    event UtangPaid(uint id);
    event UtangDeleted(uint id);
    event UtangEdited(uint id, uint newAmount, string newItems);
    
    // VULN #6 FIX: Ownership transfer events
    event OwnershipTransferRequested(address indexed currentOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    
    // VULN #5 FIX: Delete confirmation events
    event DeleteRequested(uint indexed id, uint timestamp);
    event DeleteConfirmed(uint indexed id, uint timestamp);
    event DeleteCancelled(uint indexed id, uint timestamp);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Only store owner authorized");
        _;
    }
    
    constructor() {
        owner = msg.sender;
    }
    
    // VULN #4 FIX: Set customer debt limit
    function setCustomerDebtLimit(address _customer, uint _limit) public onlyOwner {
        require(_customer != address(0), "Invalid customer address");
        customerDebtLimit[_customer] = _limit;
    }
    
    // 1. Record utang - Owner only (with VULN #2 and #4 FIXES)
    function addUtang(address _customer, uint _amount, string memory _items) public onlyOwner {
        // VULN #2 FIX: Input validation
        require(_customer != address(0), "Customer address cannot be zero");
        require(_amount > 0, "Amount must be greater than zero");
        require(_amount <= 10000, "Amount exceeds maximum limit");
        require(bytes(_items).length > 0, "Items description cannot be empty");
        
        // VULN #4 FIX: Check debt limit
        uint currentDebt = getTotalUnpaid(_customer);
        uint limit = customerDebtLimit[_customer];
        if (limit == 0) limit = 5000; // Default limit
        require(currentDebt + _amount <= limit, "Exceeds customer debt limit");
        
        uint newId = utangList.length;
        utangList.push(Utang(newId, _customer, _amount, _items, false, block.timestamp));
        activeUtang[newId] = true;
        emit NewUtang(newId, _customer, _amount, _items);
    }
    
    // 2. Mark as paid - Owner only (with VULN #1 FIX)
    function markAsPaid(uint _id) public onlyOwner {
        // VULN #1 FIX: Array bounds check
        require(_id < utangList.length, "Utang ID does not exist");
        require(activeUtang[_id], "Utang is not active");
        require(!utangList[_id].paid, "Already paid");
        
        utangList[_id].paid = true;
        emit UtangPaid(_id);
    }
    
    // 3. Delete utang - REPLACED with VULN #5 FIX (two-step delete)
    function requestDeleteUtang(uint _id) public onlyOwner {
        // VULN #1 FIX: Array bounds check
        require(_id < utangList.length, "Utang ID does not exist");
        require(activeUtang[_id], "Utang does not exist");
        require(!pendingDelete[_id], "Delete already requested");
        
        pendingDelete[_id] = true;
        emit DeleteRequested(_id, block.timestamp);
    }
    
    function confirmDeleteUtang(uint _id) public onlyOwner {
        // VULN #1 FIX: Array bounds check
        require(_id < utangList.length, "Utang ID does not exist");
        require(activeUtang[_id], "Utang does not exist");
        require(pendingDelete[_id], "No delete request found");
        
        activeUtang[_id] = false;
        delete pendingDelete[_id];
        emit DeleteConfirmed(_id, block.timestamp);
        emit UtangDeleted(_id);
    }
    
    function cancelDeleteUtang(uint _id) public onlyOwner {
        require(pendingDelete[_id], "No delete request to cancel");
        delete pendingDelete[_id];
        emit DeleteCancelled(_id, block.timestamp);
    }
    
    // 4. Edit utang - Owner only (with VULN #1 and #2 FIXES)
    function editUtang(uint _id, uint _newAmount, string memory _newItems) public onlyOwner {
        // VULN #1 FIX: Array bounds check
        require(_id < utangList.length, "Utang ID does not exist");
        require(activeUtang[_id], "Utang does not exist");
        require(!utangList[_id].paid, "Cannot edit paid utang");
        
        // VULN #2 FIX: Input validation
        require(_newAmount > 0, "Amount must be greater than zero");
        require(_newAmount <= 10000, "Amount exceeds maximum limit");
        require(bytes(_newItems).length > 0, "Items description cannot be empty");
        
        utangList[_id].amount = _newAmount;
        utangList[_id].items = _newItems;
        emit UtangEdited(_id, _newAmount, _newItems);
    }
    
    // 5. View customer utang - with VULN #3 FIX (pagination)
    function getCustomerUtang(address _customer, uint _offset, uint _limit) 
        public view returns (Utang[] memory) 
    {
        require(_customer != address(0), "Invalid address");
        
        // Temporary array with max size = _limit
        Utang[] memory temp = new Utang[](_limit);
        uint index = 0;
        uint found = 0;
        
        // Stop when we have enough records or reach end of array
        for(uint i = 0; i < utangList.length && index < _limit; i++) {
            if(utangList[i].customer == _customer && activeUtang[i]) {
                if(found >= _offset) {
                    temp[index] = utangList[i];
                    index++;
                }
                found++;
            }
        }
        
        // Resize array to actual count
        Utang[] memory result = new Utang[](index);
        for(uint i = 0; i < index; i++) {
            result[i] = temp[i];
        }
        return result;
    }
    
    // Backward compatibility - default to first 50 records
    function getCustomerUtang(address _customer) public view returns (Utang[] memory) {
        return getCustomerUtang(_customer, 0, 50);
    }
    
    // 6. Get total unpaid - with VULN #3 FIX (max loop limit)
    function getTotalUnpaid(address _customer) public view returns (uint) {
        require(_customer != address(0), "Invalid address");
        
        uint total = 0;
        // Safety limit: max 1000 iterations
        for(uint i = 0; i < utangList.length && i < 1000; i++) {
            if(utangList[i].customer == _customer && activeUtang[i] && !utangList[i].paid) {
                total += utangList[i].amount;
            }
        }
        return total;
    }
    
    // 7. Security: Verify utang exists and is active (with VULN #1 FIX)
    function verifyUtang(uint _id) public view returns (bool) {
        return _id < utangList.length && activeUtang[_id];
    }
    
    // VULN #6 FIX: Two-phase ownership transfer
    function transferOwnership(address newOwner) public onlyOwner {
        require(newOwner != address(0), "New owner cannot be zero address");
        pendingOwner = newOwner;
        emit OwnershipTransferRequested(owner, newOwner);
    }
    
    function acceptOwnership() public {
        require(msg.sender == pendingOwner, "Only pending owner can accept");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }
    
    function getPendingOwner() public view returns (address) {
        return pendingOwner;
    }
}