import type { Eip712TypedDataPayload } from "../../types";

export const calldataVectors = [
  {
    name: "empty calldata",
    calldata: "0x",
    expected: "0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563"
  },
  {
    name: "ERC-20 approve calldata",
    calldata: "0x095ea7b3000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000003e8",
    expected: "0x2ea2a30a744c4832485dc9477ae03339af33497fc7a927a6be473f65efee9549"
  }
] as const;

export const typedDataVectors: Array<{
  name: string;
  payload: Eip712TypedDataPayload;
  expected: {
    domainSeparator: string;
    messageHash: string;
    finalDigest: string;
  };
}> = [
  {
    name: "EIP-712 Ether Mail",
    payload: {
      domain: {
        name: "Ether Mail",
        version: "1",
        chainId: 1,
        verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC"
      },
      types: {
        Person: [
          { name: "name", type: "string" },
          { name: "wallet", type: "address" }
        ],
        Mail: [
          { name: "from", type: "Person" },
          { name: "to", type: "Person" },
          { name: "contents", type: "string" }
        ]
      },
      primaryType: "Mail",
      message: {
        from: { name: "Cow", wallet: "0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826" },
        to: { name: "Bob", wallet: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB" },
        contents: "Hello, Bob!"
      }
    },
    expected: {
      domainSeparator: "0xf2cee375fa42b42143804025fc449deafd50cc031ca257e0b194a650a912090f",
      messageHash: "0xc52c0ee5d84264471806290a3f2c4cecfc5490626bf912d01f240d7a274b371e",
      finalDigest: "0xbe609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2"
    }
  },
  {
    name: "EIP-2612-style Permit",
    payload: {
      domain: {
        name: "USD Coin",
        version: "2",
        chainId: 1,
        verifyingContract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
      },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      },
      primaryType: "Permit",
      message: {
        owner: "0x1111111111111111111111111111111111111111",
        spender: "0x2222222222222222222222222222222222222222",
        value: "1000000",
        nonce: "7",
        deadline: "1700000000"
      }
    },
    expected: {
      domainSeparator: "0x06c37168a7db5138defc7866392bb87a741f9b3d104deb5094588ce041cae335",
      messageHash: "0x6bef16cd6bbb612659079de52d17de907f5bf50c9b296cd05acbce68e5e64000",
      finalDigest: "0x5d50fab304dbec46f631dd24a2c8ca5f6cbc9ef54e3305755ea6b7e8344e9994"
    }
  }
];

export const safeVectors = [
  {
    name: "Safe v1.4.1 chain-aware domain",
    safe: "0x1111111111111111111111111111111111111111",
    chainId: "1",
    version: "1.4.1",
    tx: {
      to: "0x2222222222222222222222222222222222222222",
      value: "123",
      data: "0x1234",
      operation: 0,
      safeTxGas: "456",
      baseGas: "789",
      gasPrice: "10",
      gasToken: "0x0000000000000000000000000000000000000000",
      refundReceiver: "0x3333333333333333333333333333333333333333",
      nonce: "5"
    },
    expected: "0x26b66d476ff953372e6e0b9ac7a024c015cd53fbe1463deec5039890f55e35a5"
  },
  {
    name: "Safe v1.2.0 legacy domain",
    safe: "0x1111111111111111111111111111111111111111",
    chainId: "1",
    version: "1.2.0",
    tx: {
      to: "0x2222222222222222222222222222222222222222",
      value: "123",
      data: "0x1234",
      operation: 0,
      safeTxGas: "456",
      baseGas: "789",
      gasPrice: "10",
      gasToken: "0x0000000000000000000000000000000000000000",
      refundReceiver: "0x3333333333333333333333333333333333333333",
      nonce: "5"
    },
    expected: "0x7457db12fd45f4ca978c170539add039775e5c0aa0258be101395cf7f290775d"
  },
  {
    name: "Nested Safe approveHash outer transaction",
    safe: "0x4444444444444444444444444444444444444444",
    chainId: "1",
    version: "1.4.1",
    innerHash: "0x26b66d476ff953372e6e0b9ac7a024c015cd53fbe1463deec5039890f55e35a5",
    tx: {
      to: "0x1111111111111111111111111111111111111111",
      value: "0",
      data: "0xd4d9bdcd26b66d476ff953372e6e0b9ac7a024c015cd53fbe1463deec5039890f55e35a5",
      operation: 0,
      safeTxGas: "0",
      baseGas: "0",
      gasPrice: "0",
      gasToken: "0x0000000000000000000000000000000000000000",
      refundReceiver: "0x0000000000000000000000000000000000000000",
      nonce: "9"
    },
    expected: "0x30f86a8ff19527fbd9459dabb5ef83a2328f631189cd7a1a9ffd11dcbbd27c82"
  }
] as const;

export const rawRequestVector = {
  params: [{
    data: calldataVectors[1].calldata,
    to: "0x0000000000000000000000000000000000000003",
    value: "0x0"
  }]
} as const;
