// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract ListaTrust {
    struct Utang {
        uint id;
        address storeOwner;      // Who owns this debt record (the store owner)
        string debtorName;        // Name of person who owes (e.g., "Aling Nena")
        uint amount;
        string items;             // Pipe-separated items: "banana|milk|rice"
        bool paid;
        uint timestamp;
    }
    
    Utang[] public utangList;
    address public owner;
    address public pendingOwner;
    
    // Track active utang per store owner - using mapping for efficiency
    mapping(address => uint[]) public storeOwnerUtangIds;
    mapping(address => mapping(uint => bool)) public activeUtang;
    
    // Store owner debt limits
    mapping(address => uint) public storeOwnerDebtLimit;
    
    // Track pending deletions
    mapping(uint => bool) public pendingDelete;
    
    // Events
    event NewUtang(uint id, address indexed storeOwner, string debtorName, uint amount, string items);
    event UtangPaid(uint id);
    event UtangDeleted(uint id);
    event UtangEdited(uint id, uint newAmount, string newItems);
    event OwnershipTransferRequested(address indexed currentOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event DeleteRequested(uint indexed id, uint timestamp);
    event DeleteConfirmed(uint indexed id, uint timestamp);
    event DeleteCancelled(uint indexed id, uint timestamp);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Only contract owner authorized");
        _;
    }
    
    modifier onlyStoreOwner() {
        _;
    }
    
    constructor() {
        owner = msg.sender;
    }
    
    // Set store owner debt limit
    function setStoreOwnerDebtLimit(address _storeOwner, uint _limit) public onlyOwner {
        require(_storeOwner != address(0), "Invalid store owner address");
        storeOwnerDebtLimit[_storeOwner] = _limit;
    }
    
    // 1. Record utang - OPTIMIZED for gas
    function addUtang(string memory _debtorName, uint _amount, string memory _items) public {
        require(bytes(_debtorName).length > 0, "Debtor name cannot be empty");
        require(_amount > 0, "Amount must be greater than zero");
        require(_amount <= 10000, "Amount exceeds maximum limit");
        require(bytes(_items).length > 0, "Items description cannot be empty");
        
        // Check store owner's total debt limit
        uint currentDebt = getTotalUnpaid(msg.sender);
        uint limit = storeOwnerDebtLimit[msg.sender];
        if (limit == 0) limit = 50000; // Default limit per store owner
        require(currentDebt + _amount <= limit, "Exceeds store owner debt limit");
        
        uint newId = utangList.length;
        utangList.push(Utang(newId, msg.sender, _debtorName, _amount, _items, false, block.timestamp));
        storeOwnerUtangIds[msg.sender].push(newId);
        activeUtang[msg.sender][newId] = true;
        emit NewUtang(newId, msg.sender, _debtorName, _amount, _items);
    }
    
    // 2. Mark as paid - OPTIMIZED for gas
    function markAsPaid(uint _id) public {
        require(_id < utangList.length, "Utang ID does not exist");
        require(utangList[_id].storeOwner == msg.sender, "Not your debt record");
        require(activeUtang[msg.sender][_id], "Utang is not active");
        require(!utangList[_id].paid, "Already paid");
        
        utangList[_id].paid = true;
        // Note: We keep activeUtang true for history but mark paid flag
        emit UtangPaid(_id);
    }
    
    // 3. Two-step delete
    function requestDeleteUtang(uint _id) public {
        require(_id < utangList.length, "Utang ID does not exist");
        require(utangList[_id].storeOwner == msg.sender, "Not your debt record");
        require(activeUtang[msg.sender][_id], "Utang does not exist");
        require(!pendingDelete[_id], "Delete already requested");
        
        pendingDelete[_id] = true;
        emit DeleteRequested(_id, block.timestamp);
    }
    
    function confirmDeleteUtang(uint _id) public {
        require(_id < utangList.length, "Utang ID does not exist");
        require(utangList[_id].storeOwner == msg.sender, "Not your debt record");
        require(activeUtang[msg.sender][_id], "Utang does not exist");
        require(pendingDelete[_id], "No delete request found");
        
        activeUtang[msg.sender][_id] = false;
        delete pendingDelete[_id];
        emit DeleteConfirmed(_id, block.timestamp);
        emit UtangDeleted(_id);
    }
    
    function cancelDeleteUtang(uint _id) public {
        require(pendingDelete[_id], "No delete request to cancel");
        delete pendingDelete[_id];
        emit DeleteCancelled(_id, block.timestamp);
    }
    
    // 4. Edit utang
    function editUtang(uint _id, uint _newAmount, string memory _newItems) public {
        require(_id < utangList.length, "Utang ID does not exist");
        require(utangList[_id].storeOwner == msg.sender, "Not your debt record");
        require(activeUtang[msg.sender][_id], "Utang does not exist");
        require(!utangList[_id].paid, "Cannot edit paid utang");
        
        require(_newAmount > 0, "Amount must be greater than zero");
        require(_newAmount <= 10000, "Amount exceeds maximum limit");
        require(bytes(_newItems).length > 0, "Items description cannot be empty");
        
        utangList[_id].amount = _newAmount;
        utangList[_id].items = _newItems;
        emit UtangEdited(_id, _newAmount, _newItems);
    }
    
    // 5. Get store owner's utang - OPTIMIZED for gas
    function getMyUtang(uint _offset, uint _limit) public view returns (Utang[] memory) {
        uint[] storage ownerIds = storeOwnerUtangIds[msg.sender];
        
        uint start = _offset;
        uint end = _offset + _limit;
        if (end > ownerIds.length) {
            end = ownerIds.length;
        }
        
        if (start >= ownerIds.length) {
            return new Utang[](0);
        }
        
        uint resultCount = end - start;
        Utang[] memory result = new Utang[](resultCount);
        
        for (uint i = 0; i < resultCount; i++) {
            uint id = ownerIds[start + i];
            if (activeUtang[msg.sender][id]) {
                result[i] = utangList[id];
            }
        }
        
        return result;
    }
    
    // Backward compatibility
    function getMyUtang() public view returns (Utang[] memory) {
        return getMyUtang(0, 50);
    }
    
    // 6. Get total unpaid for store owner - OPTIMIZED for gas
    function getTotalUnpaid(address _storeOwner) public view returns (uint) {
        uint total = 0;
        uint[] storage ownerIds = storeOwnerUtangIds[_storeOwner];
        
        for(uint i = 0; i < ownerIds.length; i++) {
            uint id = ownerIds[i];
            if (activeUtang[_storeOwner][id] && !utangList[id].paid) {
                total += utangList[id].amount;
            }
        }
        return total;
    }
    
    // 7. Verify utang exists
    function verifyUtang(uint _id) public view returns (bool) {
        return _id < utangList.length;
    }
    
    // Ownership transfer functions
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