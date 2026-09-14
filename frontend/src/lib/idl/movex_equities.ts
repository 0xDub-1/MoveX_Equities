/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/movex_equities.json`.
 */
export type MovexEquities = {
  "address": "9j2X63EpuSxBSqfMKNrcbQUFzzrXiU8ok2PbUYucZ8zL",
  "metadata": {
    "name": "movexEquities",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Daily volatility markets on US stocks"
  },
  "instructions": [
    {
      "name": "claim",
      "docs": [
        "Collects a winning share, or a refund from a voided market."
      ],
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "docs": [
            "Not mutable. The pools stay as the record of what was deposited, so a",
            "claim never rewrites the denominator other claimants are dividing by."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.underlying",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.sessionDate",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.tier",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "position",
          "docs": [
            "Seeds bind this to `user`, who signs, so no other position is",
            "reachable from here."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "collectFee",
      "docs": [
        "Pushes a settled market's protocol fee to its treasury."
      ],
      "discriminator": [
        60,
        173,
        247,
        103,
        4,
        93,
        130,
        48
      ],
      "accounts": [
        {
          "name": "cranker",
          "docs": [
            "Anyone may push the fee to the treasury. It can only go to the",
            "address the market was created with, so there is nothing to gain by",
            "calling it and no reason to gate it."
          ],
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.underlying",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.sessionDate",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.tier",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "treasuryTokenAccount",
          "writable": true
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "deposit",
      "docs": [
        "Deposits into ABOVE or BELOW. Open until the market locks."
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.underlying",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.sessionDate",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.tier",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "side",
          "type": {
            "defined": {
              "name": "side"
            }
          }
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "faucetMint",
      "docs": [
        "Mints one allowance of the test token, subject to the cooldown."
      ],
      "discriminator": [
        47,
        229,
        221,
        88,
        0,
        56,
        156,
        38
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "faucet",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  97,
                  117,
                  99,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "claim",
          "docs": [
            "Per-user, so one wallet draining the faucet does not affect anyone",
            "else's cooldown."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  97,
                  117,
                  99,
                  101,
                  116,
                  95,
                  99,
                  108,
                  97,
                  105,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "mint",
          "writable": true,
          "relations": [
            "faucet"
          ]
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initFaucet",
      "docs": [
        "Opens a test-token faucet. Compiled out without `devnet-faucet`."
      ],
      "discriminator": [
        122,
        64,
        137,
        151,
        7,
        139,
        100,
        57
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "faucet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  97,
                  117,
                  99,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "The faucet PDA must already hold mint authority, which is what makes",
            "`faucet_mint` the only path to new supply. Anchor checks it here",
            "rather than trusting the deployer to have wired it correctly."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amountPerClaim",
          "type": "u64"
        },
        {
          "name": "cooldownSecs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "initMarket",
      "docs": [
        "Creates a market with a frozen strike and its own vault.",
        "",
        "The strike is not taken on trust. The instruction recomputes the",
        "percentile from the sample series it was given and rejects the market",
        "unless the two agree."
      ],
      "discriminator": [
        33,
        253,
        15,
        116,
        89,
        25,
        127,
        236
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "params.underlying"
              },
              {
                "kind": "arg",
                "path": "params.sessionDate"
              },
              {
                "kind": "arg",
                "path": "params.tier"
              }
            ]
          }
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "vault",
          "docs": [
            "Holds every deposit for this market. Its authority is the market PDA,",
            "so nothing can move funds except this program."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "pythFeed",
          "docs": [
            "read here; validated when `lock` and `settle` actually consume it."
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "initMarketParams"
            }
          }
        }
      ]
    },
    {
      "name": "initPriceFeed",
      "docs": [
        "Opens a keeper-published price feed for one underlying.",
        "",
        "Compiled out without `keeper-oracle`: a mainnet build reads Pyth and",
        "has no instruction capable of writing a price at all."
      ],
      "discriminator": [
        27,
        209,
        184,
        5,
        152,
        116,
        136,
        16
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "priceFeed",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  105,
                  99,
                  101,
                  95,
                  102,
                  101,
                  101,
                  100
                ]
              },
              {
                "kind": "arg",
                "path": "underlying"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "underlying",
          "type": {
            "array": [
              "u8",
              8
            ]
          }
        },
        {
          "name": "publisher",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "lock",
      "docs": [
        "Freezes deposits and records the reference price. Permissionless."
      ],
      "discriminator": [
        21,
        19,
        208,
        43,
        237,
        62,
        255,
        87
      ],
      "accounts": [
        {
          "name": "cranker",
          "docs": [
            "Pays the fee. Anyone at all."
          ],
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.underlying",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.sessionDate",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.tier",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "priceFeed",
          "docs": [
            "feed this market was created with so a crank cannot substitute one."
          ]
        }
      ],
      "args": []
    },
    {
      "name": "settle",
      "docs": [
        "Records the settlement price and picks a side. Permissionless."
      ],
      "discriminator": [
        175,
        42,
        185,
        87,
        144,
        131,
        102,
        212
      ],
      "accounts": [
        {
          "name": "cranker",
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.underlying",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.sessionDate",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.tier",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "priceFeed",
          "docs": [
            "feed this market was created with."
          ]
        }
      ],
      "args": []
    },
    {
      "name": "updatePrice",
      "docs": [
        "Publishes a price. Only the feed's publisher may call it."
      ],
      "discriminator": [
        61,
        34,
        117,
        155,
        75,
        34,
        123,
        208
      ],
      "accounts": [
        {
          "name": "publisher",
          "docs": [
            "Constrained to the publisher the feed was created with, so a feed",
            "cannot be hijacked by whoever calls first."
          ],
          "signer": true,
          "relations": [
            "priceFeed"
          ]
        },
        {
          "name": "priceFeed",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  105,
                  99,
                  101,
                  95,
                  102,
                  101,
                  101,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "priceFeed.underlying",
                "account": "priceFeed"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "price",
          "type": "u64"
        },
        {
          "name": "conf",
          "type": "u64"
        },
        {
          "name": "publishTime",
          "type": "i64"
        },
        {
          "name": "sourceCount",
          "type": "u8"
        }
      ]
    },
    {
      "name": "voidMarket",
      "docs": [
        "Releases a market that never resolved. Permissionless, and only after",
        "the grace period."
      ],
      "discriminator": [
        243,
        175,
        46,
        124,
        95,
        101,
        39,
        69
      ],
      "accounts": [
        {
          "name": "cranker",
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.underlying",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.sessionDate",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.tier",
                "account": "market"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "withdraw",
      "docs": [
        "Pulls a deposit back out. Only before lock."
      ],
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.underlying",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.sessionDate",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.tier",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "position",
          "docs": [
            "The seeds already bind this to `user`, who signs, so no separate",
            "ownership constraint is needed: no other user's position can be",
            "passed here at all."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "faucet",
      "discriminator": [
        146,
        11,
        249,
        142,
        199,
        197,
        61,
        0
      ]
    },
    {
      "name": "faucetClaim",
      "discriminator": [
        88,
        39,
        189,
        221,
        15,
        215,
        24,
        248
      ]
    },
    {
      "name": "market",
      "discriminator": [
        219,
        190,
        213,
        55,
        0,
        227,
        198,
        154
      ]
    },
    {
      "name": "position",
      "discriminator": [
        170,
        188,
        143,
        228,
        122,
        64,
        247,
        208
      ]
    },
    {
      "name": "priceFeed",
      "discriminator": [
        189,
        103,
        252,
        23,
        152,
        35,
        243,
        156
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "marketNotOpen",
      "msg": "Market is not open for deposits"
    },
    {
      "code": 6001,
      "name": "depositWindowClosed",
      "msg": "The deposit window has closed"
    },
    {
      "code": 6002,
      "name": "depositTooSmall",
      "msg": "Deposit is below the minimum"
    },
    {
      "code": 6003,
      "name": "insufficientPosition",
      "msg": "Withdrawal exceeds the position balance"
    },
    {
      "code": 6004,
      "name": "sideMismatch",
      "msg": "A position already exists on the other side of this market"
    },
    {
      "code": 6005,
      "name": "feeTooHigh",
      "msg": "Fee exceeds the maximum allowed"
    },
    {
      "code": 6006,
      "name": "strikeTooSmall",
      "msg": "Strike must be greater than zero"
    },
    {
      "code": 6007,
      "name": "samplesNotSorted",
      "msg": "The sample series must be sorted ascending"
    },
    {
      "code": 6008,
      "name": "strikeNotDerivedFromSamples",
      "msg": "Strike does not match the percentile of its own sample series"
    },
    {
      "code": 6009,
      "name": "lockTimeInPast",
      "msg": "Lock time must be in the future"
    },
    {
      "code": 6010,
      "name": "settleBeforeLock",
      "msg": "Settle time must be after lock time"
    },
    {
      "code": 6011,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6012,
      "name": "marketNotLocked",
      "msg": "Market is not locked"
    },
    {
      "code": 6013,
      "name": "marketNotResolved",
      "msg": "Market has not resolved yet"
    },
    {
      "code": 6014,
      "name": "tooEarlyToLock",
      "msg": "Too early to lock this market"
    },
    {
      "code": 6015,
      "name": "tooEarlyToSettle",
      "msg": "Too early to settle this market"
    },
    {
      "code": 6016,
      "name": "tooEarlyToVoid",
      "msg": "Too early to void this market"
    },
    {
      "code": 6017,
      "name": "marketAlreadyResolved",
      "msg": "Market has already resolved"
    },
    {
      "code": 6018,
      "name": "oracleFeedMismatch",
      "msg": "Oracle account does not match the one this market was created with"
    },
    {
      "code": 6019,
      "name": "oracleAccountInvalid",
      "msg": "Oracle account could not be read"
    },
    {
      "code": 6020,
      "name": "oraclePriceStale",
      "msg": "Oracle price is stale"
    },
    {
      "code": 6021,
      "name": "oraclePriceInvalid",
      "msg": "Oracle price is not usable"
    },
    {
      "code": 6022,
      "name": "oracleNotConfigured",
      "msg": "This build has no oracle configured"
    },
    {
      "code": 6023,
      "name": "oracleConfidenceTooWide",
      "msg": "Oracle confidence interval is too wide to settle against"
    },
    {
      "code": 6024,
      "name": "oracleUnauthorizedPublisher",
      "msg": "Only this feed's publisher may write to it"
    },
    {
      "code": 6025,
      "name": "oraclePriceNotNewer",
      "msg": "Price is not newer than the one already published"
    },
    {
      "code": 6026,
      "name": "alreadyClaimed",
      "msg": "This position has already been claimed"
    },
    {
      "code": 6027,
      "name": "notOnWinningSide",
      "msg": "This position is not on the winning side"
    },
    {
      "code": 6028,
      "name": "nothingToClaim",
      "msg": "There is nothing to claim"
    },
    {
      "code": 6029,
      "name": "feeAlreadyCollected",
      "msg": "The protocol fee has already been collected"
    },
    {
      "code": 6030,
      "name": "faucetCooldownActive",
      "msg": "Faucet cooldown has not elapsed yet"
    },
    {
      "code": 6031,
      "name": "faucetAmountInvalid",
      "msg": "Faucet claim amount is outside the allowed range"
    }
  ],
  "types": [
    {
      "name": "faucet",
      "docs": [
        "Configuration for a self-serve test-token faucet.",
        "",
        "The PDA itself is the mint authority, so the only way to create supply is",
        "through `faucet_mint` and its cooldown. Gated on `devnet-faucet`: a",
        "production build has no instruction that can mint the quote asset."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "amountPerClaim",
            "type": "u64"
          },
          {
            "name": "cooldownSecs",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "faucetClaim",
      "docs": [
        "One user's claim history against one faucet."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "faucet",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "lastClaimTs",
            "type": "i64"
          },
          {
            "name": "totalClaimed",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "initMarketParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "underlying",
            "docs": [
              "Ticker as ASCII, right-padded with spaces. `b\"NVDA    \"`."
            ],
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "sessionDate",
            "docs": [
              "`YYYY-MM-DD` of the session whose close becomes the reference price."
            ],
            "type": {
              "array": [
                "u8",
                10
              ]
            }
          },
          {
            "name": "tier",
            "type": {
              "defined": {
                "name": "tier"
              }
            }
          },
          {
            "name": "strikeBps",
            "type": "u16"
          },
          {
            "name": "samplesBps",
            "docs": [
              "The 20 close-to-close moves the strike was read from, sorted ascending."
            ],
            "type": {
              "array": [
                "u16",
                20
              ]
            }
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "treasury",
            "docs": [
              "Wallet entitled to the fee on this market."
            ],
            "type": "pubkey"
          },
          {
            "name": "lockTs",
            "type": "i64"
          },
          {
            "name": "settleTs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "market",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "Allowed to create the market. Settlement is permissionless."
            ],
            "type": "pubkey"
          },
          {
            "name": "underlying",
            "docs": [
              "Ticker as ASCII, right-padded with spaces. Part of the PDA seeds."
            ],
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "sessionDate",
            "docs": [
              "`YYYY-MM-DD` of the session whose close is the reference price."
            ],
            "type": {
              "array": [
                "u8",
                10
              ]
            }
          },
          {
            "name": "tier",
            "type": {
              "defined": {
                "name": "tier"
              }
            }
          },
          {
            "name": "pythFeed",
            "docs": [
              "Pyth price account this market settles against."
            ],
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "docs": [
              "SPL mint deposits are denominated in (USDC)."
            ],
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strikeBps",
            "docs": [
              "The threshold, in basis points. 155 = 1.55%.",
              "",
              "Not taken on trust: `init_market` recomputes the percentile from",
              "`samples_bps` and rejects the market unless they agree. The strike is",
              "enforced by the program, not merely asserted by the keeper."
            ],
            "type": "u16"
          },
          {
            "name": "samplesBps",
            "docs": [
              "The 20 absolute close-to-close moves the strike was read from, in",
              "basis points, sorted ascending.",
              "",
              "These are the public justification for the threshold. Holding them on",
              "chain is the difference between \"trust our API\" and \"here are the",
              "twenty numbers, and the program checked them itself\"."
            ],
            "type": {
              "array": [
                "u16",
                20
              ]
            }
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "marketState"
              }
            }
          },
          {
            "name": "referencePrice",
            "docs": [
              "Written at lock. Zero until then."
            ],
            "type": "u64"
          },
          {
            "name": "settlementPrice",
            "docs": [
              "Written at settle. Zero until then."
            ],
            "type": "u64"
          },
          {
            "name": "abovePool",
            "type": "u64"
          },
          {
            "name": "belowPool",
            "type": "u64"
          },
          {
            "name": "winningSide",
            "docs": [
              "Written at settle."
            ],
            "type": {
              "option": {
                "defined": {
                  "name": "side"
                }
              }
            }
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "treasury",
            "docs": [
              "Wallet entitled to the protocol fee. The destination token account",
              "must be owned by it, so the fee has a declared home from the moment",
              "the market is created rather than being decided later."
            ],
            "type": "pubkey"
          },
          {
            "name": "feeCollected",
            "docs": [
              "The fee is a single withdrawal, not a running balance."
            ],
            "type": "bool"
          },
          {
            "name": "lockTs",
            "docs": [
              "Deposits close at this time and the reference price is taken."
            ],
            "type": "i64"
          },
          {
            "name": "settleTs",
            "docs": [
              "The settlement price is taken at this time."
            ],
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "marketState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "locked"
          },
          {
            "name": "settled"
          },
          {
            "name": "voided"
          }
        ]
      }
    },
    {
      "name": "position",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "side",
            "docs": [
              "Which pool the deposit sits in. One position per user per market, so",
              "a user picks a side rather than holding both. Once `amount` returns",
              "to zero the side is free to change again."
            ],
            "type": {
              "defined": {
                "name": "side"
              }
            }
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "claimed",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "priceFeed",
      "docs": [
        "A price published by our own keeper.",
        "",
        "Deliberately shaped like a Pyth sponsored feed: one fixed address per",
        "underlying, updated continuously, read by both the program and the UI.",
        "That is not imitation for its own sake. It means swapping to Pyth on",
        "mainnet changes one file rather than the shape of everything above it.",
        "",
        "What it lacks compared to Pyth is not structure, it is publishers. There",
        "is exactly one and it is us, which is stated plainly in the README rather",
        "than papered over. It exists because Pyth moved Hermes behind a $500/month",
        "key in August 2026, which is outside a hackathon budget.",
        "",
        "Compiled out entirely without `keeper-oracle`, so a production build has",
        "no such account type and no instruction that writes one."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "underlying",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "publisher",
            "docs": [
              "The only key allowed to write prices here."
            ],
            "type": "pubkey"
          },
          {
            "name": "price",
            "docs": [
              "Scaled by `KEEPER_PRICE_EXPONENT`."
            ],
            "type": "u64"
          },
          {
            "name": "conf",
            "docs": [
              "Spread across the sources that agreed on it, same scale.",
              "",
              "The analogue of Pyth's confidence interval, and consumed by exactly",
              "the same check: a wide band means the sources disagree and the market",
              "refuses to settle rather than picking a number out of the spread."
            ],
            "type": "u64"
          },
          {
            "name": "publishTime",
            "docs": [
              "When the *source* produced this price, not when it was written here.",
              "",
              "The distinction is the whole staleness check. A price written a second",
              "ago carrying Friday's close is stale, and must read as stale."
            ],
            "type": "i64"
          },
          {
            "name": "postedSlot",
            "docs": [
              "Slot of the write. Only for diagnosing publisher lag."
            ],
            "type": "u64"
          },
          {
            "name": "sourceCount",
            "docs": [
              "How many independent sources agreed on this price."
            ],
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "side",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "above"
          },
          {
            "name": "below"
          }
        ]
      }
    },
    {
      "name": "tier",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "tight"
          },
          {
            "name": "fair"
          },
          {
            "name": "wide"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "faucetClaimSeed",
      "type": "bytes",
      "value": "[102, 97, 117, 99, 101, 116, 95, 99, 108, 97, 105, 109]"
    },
    {
      "name": "faucetSeed",
      "type": "bytes",
      "value": "[102, 97, 117, 99, 101, 116]"
    },
    {
      "name": "marketSeed",
      "type": "bytes",
      "value": "[109, 97, 114, 107, 101, 116]"
    },
    {
      "name": "positionSeed",
      "type": "bytes",
      "value": "[112, 111, 115, 105, 116, 105, 111, 110]"
    },
    {
      "name": "priceFeedSeed",
      "type": "bytes",
      "value": "[112, 114, 105, 99, 101, 95, 102, 101, 101, 100]"
    },
    {
      "name": "vaultSeed",
      "type": "bytes",
      "value": "[118, 97, 117, 108, 116]"
    }
  ]
};
