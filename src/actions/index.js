import { useWallet } from "@solana/wallet-adapter-react";
import {
  SystemProgram,
  Transaction,
  PublicKey,
  TransactionInstruction,
  Connection,
} from "@solana/web3.js";

import axios from "../config";
import { deserialize, serialize } from "borsh";

const programAccount = new PublicKey(
  "3MWn8G9eHvHXRpdb9fBduDpD5XD4SLbgxkbBwe2s9G8Q"
);
const adminAccount = new PublicKey(
  "6wTtu65bS4FkANr2DeuRvbWQ7BsefwSaP5pF2MFTK62P"
);

const cluster = "https://api.devnet.solana.com";
const connection = new Connection(cluster, "confirmed");

class CreateStreamInput {
  constructor(properties) {
    Object.keys(properties).forEach((key) => {
      this[key] = properties[key];
    });
  }
  static schema = new Map([
    [
      CreateStreamInput,
      {
        kind: "struct",
        fields: [
          ["start_time", "u64"],
          ["end_time", "u64"],
          ["receiver", [32]],
          ["lamports_withdrawn", "u64"],
          ["amount_second", "u64"],
        ],
      },
    ],
  ]);
}

class WithdrawInput {
  constructor(properties) {
    Object.keys(properties).forEach((key) => {
      this[key] = properties[key];
    });
  }
  static schema = new Map([[WithdrawInput,
    {
      kind: 'struct',
      fields: [
        ['amount', 'u64'],
      ]
    }]]);
}


export const withdraw = (streamId, amountToWithdraw, wallet) => {
  return async (dispatch, getState) => {
    try {
      let withdraw_input = new WithdrawInput({
        amount: amountToWithdraw
      });
      let data = serialize(WithdrawInput.schema, withdraw_input);
      let data_to_send = new Uint8Array([2, ...data]);

      const instructionTOOurProgram = new TransactionInstruction({
        keys: [
          { pubkey: streamId, isSigner: false, isWritable: true},
          { pubkey: wallet.PublicKey, isSigner: true, },
        ],
        programId: programAccount,
        data: data_to_send
      });

      const trans = await setPayerAndBlockhashTransaction(
        [instructionTOOurProgram], wallet
      );
      
      let signature = await wallet.sendTransaction(trans, connection);
      const result = await connection.confirmTransaction(signature);
      console.log("end sendMessage", result);
      dispatch({ type: "WITHDRAW_SUCCESS" });
    } catch (e) {
      alert(e);
      dispatch({ type: "WITHDRAW_FAILED" });
    }
  };
};

export const cancelStream = (streamId, receiverAddress, wallet) => {
  return async (dispatch, getState) => {
    try {
      const instructionTOOurProgram = new TransactionInstruction({
        keys: [
          { pubkey: streamId, isSigner: false, isWritable: true },
          { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: receiverAddress, isSigner: false, isWritable: true }
        ],
        programId: programAccount,
        data: new Uint8Array([3])
      });

      const trans = await setPayerAndBlockhashTransaction(
        [instructionTOOurProgram], wallet
      );

      let signature = await wallet.sendTransaction(trans, connection);
      const result = await connection.confirmTransaction(signature);
      console.log("end sendMessage", result);
      dispatch({ type: "CANCEL_SUCCESS" });
    } catch (e) {
      alert(e);
      dispatch({ type: "CANCEL_FAILED" });
    }
  };
};

export const createStream = ({
  receiverAddress,
  startTime,
  endTime,
  amountSpeed,
  wallet
}) => {
  return async (dispatch, getState) => {
    try {
      // Create a new pubkey (with solana's PublicKey fn) that we can use for a new PDA
      const SEED = "abcdef" + Math.random().toString();
      let newAccount = await PublicKey.createWithSeed(
        wallet.publicKey,
        SEED,
        programAccount
      );

      // Create an object for the stream instructions
      let create_stream_input = new CreateStreamInput({
        start_time: startTime,
        end_time: endTime,
        receiver: new PublicKey(receiverAddress).toBuffer(),
        lamports_withdrawn: 0,
        amount_second: amountSpeed,
      });
      let data = serialize(CreateStreamInput.schema, create_stream_input);
      // Append 1 to data as this is used as a tag to create Stream (see sol-stream-program/src/instructions.rs)
      let data_to_send = new Uint8Array([1, ...data]);

      // Use solana to figure out rent needed for addr w/ a space of 96
      let rent = await connection.getMinimumBalanceForRentExemption(96);
      // Create a Program Derived Address Account now with Solana's SystemProgram
      // (PDA is made from (seed + funding_accounts_pubkey + program_pubkey))
      //    fromPubkey supplies the lamports,
      //    basePubkey needs to match the PublicKey.createWithSeed and is used to derive the created addr.
      //    newAccountPubkey is the pubkey created (precalculated with PublicKey.createWithSeed)
      //    programId is the pubkey of the program (which will be asigned owner)
      const createProgramAccount = SystemProgram.createAccountWithSeed({
        fromPubkey: wallet.publicKey,
        basePubkey: wallet.publicKey,
        seed: SEED,
        newAccountPubkey: newAccount,
        lamports: ((endTime - startTime) * amountSpeed) + 300000 + rent,
        space: 96,
        programId: programAccount,
      });
      // Calculate lamports needed (what we want to transfer, solana rent, and admin cut)
      // newAccount is PDA being created, 
      // then we get signer's public key from their wallet
      // programId is where solana instructions are deployed to (pubkey)
      // and data is the instruction data we will be sending (with the tag for action)
      const instructionTOOurProgram = new TransactionInstruction({
        keys: [
          { pubkey: newAccount, isSigner: false, isWritable: true },
          { pubkey: wallet.publicKey, isSigner: true, },
          { pubkey: receiverAddress, isSigner: false, },
          { pubkey: adminAccount, isSigner: false, isWritable: true }
        ],
        programId: programAccount,
        data: data_to_send
      });
      // Use our helper fn to turn instr array into a Transaction obj
      const trans = await setPayerAndBlockhashTransaction(
        [createProgramAccount, instructionTOOurProgram], wallet
      );

      // Now send the transaction (using the wallet)
      let signature = await wallet.sendTransaction(trans, connection);
      // Confirm and get all the streams / catch
      const result = await connection.confirmTransaction(signature);
      console.log("end sendMessage", result);
      dispatch(getAllStreams(wallet.publicKey.toString()));
      dispatch({
        type: "CREATE_RESPONSE",
        result: true,
        id: newAccount.toString(),
      });
    } catch (e) {
      alert(e);
      dispatch({ type: "CREATE_FAILED", result: false })
    }
  };
};


export const getAllStreams = (pubkey) => {
  return async (dispatch, getState) => {
    try {
      let response = await axios.get(`/${pubkey}`);
      console.log(response);
      if (response.status !== 200) throw new Error("Something went wrong");
      // Dispatch is a callback which is evoked when async is complete so here we pass an obj
      dispatch({
        type: "DATA_RECEIVED",
        result: response.data,
      });
    } catch (e) {
      console.log(e);
      dispatch({
        type: "DATA_NOT_RECEIVED",
        result: { data: null },
      });
    }
  };
};

// Turns instruction array into transaction obj.
async function setPayerAndBlockhashTransaction(instructions, wallet) {
  const transaction = new Transaction();
  instructions.forEach(element => {
    transaction.add(element);
  });
  transaction.feePayer = wallet.publicKey;
  let hash = await connection.getRecentBlockhash();
  transaction.recentBlockhash = hash.blockhash;
  return transaction;
}