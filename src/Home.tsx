import { useEffect, useState } from "react";
import styled from "styled-components";
import confetti from "canvas-confetti";
import * as anchor from "@project-serum/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { GatewayProvider } from '@civic/solana-gateway-react';
import Countdown from "react-countdown";
import { Snackbar, Paper, LinearProgress, Chip } from "@material-ui/core";
import Alert from "@material-ui/lab/Alert";
import { toDate, AlertState, getAtaForMint } from './utils';
import { MintButton } from './MintButton';
import {
    CandyMachine,
    awaitTransactionSignatureConfirmation,
    getCandyMachineState,
    mintOneToken,
    CANDY_MACHINE_PROGRAM,
} from "./candy-machine";

const cluster = process.env.REACT_APP_SOLANA_NETWORK!.toString();
const decimals = process.env.REACT_APP_SPL_TOKEN_TO_MINT_DECIMALS ? +process.env.REACT_APP_SPL_TOKEN_TO_MINT_DECIMALS!.toString() : 9;
const splTokenName = process.env.REACT_APP_SPL_TOKEN_TO_MINT_NAME ? process.env.REACT_APP_SPL_TOKEN_TO_MINT_NAME.toString() : "TOKEN";


const WalletContainer = styled.div`
`;

const WalletAmount = styled.div`
`;

const Wallet = styled.ul`
  background-color : transparent;
  border: none;
  border-radius: 6px;
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  font-family: "Inter", "Roboto", "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 16px;
  font-weight: 600;
  height: 50px;
  line-height: 50px;
  padding: 0 20px
`;

const MintButtonContainer = styled.div`
  button.MuiButton-contained:not(.MuiButton-containedPrimary).Mui-disabled {
    color: #464646;
  }
  button.MuiButton-contained:not(.MuiButton-containedPrimary):hover,
  button.MuiButton-contained:not(.MuiButton-containedPrimary):focus {
    -webkit-animation: pulse 1s;
    animation: pulse 1s;
    box-shadow: 0 0 0 2em rgba(255, 255, 255, 0);
  }
  @-webkit-keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 #ef8f6e;
    }
  }
  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 #ef8f6e;
    }
  }
`;

const ConnectButton = styled(WalletMultiButton)`
`;


export interface HomeProps {
    candyMachineId: anchor.web3.PublicKey;
    connection: anchor.web3.Connection;
    txTimeout: number;
    rpcHost: string;
}

const Home = (props: HomeProps) => {
    const [balance, setBalance] = useState<number>();
    const [isMinting, setIsMinting] = useState(false); // true when user got to press MINT
    const [isActive, setIsActive] = useState(false); // true when countdown completes or whitelisted
    const [solanaExplorerLink, setSolanaExplorerLink] = useState<string>("");
    const [itemsAvailable, setItemsAvailable] = useState(0);
    const [itemsRedeemed, setItemsRedeemed] = useState(0);
    const [itemsRemaining, setItemsRemaining] = useState(0);
    const [isSoldOut, setIsSoldOut] = useState(false);
    const [payWithSplToken, setPayWithSplToken] = useState(false);
    const [price, setPrice] = useState(0);
    const [priceLabel, setPriceLabel] = useState<string>("SOL");
    const [whitelistPrice, setWhitelistPrice] = useState(0);
    const [whitelistEnabled, setWhitelistEnabled] = useState(false);
    const [isBurnToken, setIsBurnToken] = useState(false);
    const [whitelistTokenBalance, setWhitelistTokenBalance] = useState(0);
    const [isEnded, setIsEnded] = useState(false);
    const [endDate, setEndDate] = useState<Date>();
    const [isPresale, setIsPresale] = useState(false);
    const [isWLOnly, setIsWLOnly] = useState(false);

    const [alertState, setAlertState] = useState<AlertState>({
        open: false,
        message: "",
        severity: undefined,
    });

    const wallet = useAnchorWallet();
    const [candyMachine, setCandyMachine] = useState<CandyMachine>();

    const rpcUrl = props.rpcHost;

    const refreshCandyMachineState = () => {
        (async () => {
            if (!wallet) return;

            const cndy = await getCandyMachineState(
                wallet as anchor.Wallet,
                props.candyMachineId,
                props.connection
            );

            setCandyMachine(cndy);
            setItemsAvailable(cndy.state.itemsAvailable);
            setItemsRemaining(cndy.state.itemsRemaining);
            setItemsRedeemed(cndy.state.itemsRedeemed);

            var divider = 1;
            if (decimals) {
                divider = +('1' + new Array(decimals).join('0').slice() + '0');
            }

            // detect if using spl-token to mint
            if (cndy.state.tokenMint) {
                setPayWithSplToken(true);
                // Customize your SPL-TOKEN Label HERE
                // TODO: get spl-token metadata name
                setPriceLabel(splTokenName);
                setPrice(cndy.state.price.toNumber() / divider);
                setWhitelistPrice(cndy.state.price.toNumber() / divider);
            } else {
                setPrice(cndy.state.price.toNumber() / LAMPORTS_PER_SOL);
                setWhitelistPrice(cndy.state.price.toNumber() / LAMPORTS_PER_SOL);
            }


            // fetch whitelist token balance
            if (cndy.state.whitelistMintSettings) {
                setWhitelistEnabled(true);
                setIsBurnToken(cndy.state.whitelistMintSettings.mode.burnEveryTime);
                setIsPresale(cndy.state.whitelistMintSettings.presale);
                setIsWLOnly(!isPresale && cndy.state.whitelistMintSettings.discountPrice === null);

                if (cndy.state.whitelistMintSettings.discountPrice !== null && cndy.state.whitelistMintSettings.discountPrice !== cndy.state.price) {
                    if (cndy.state.tokenMint) {
                        setWhitelistPrice(cndy.state.whitelistMintSettings.discountPrice?.toNumber() / divider);
                    } else {
                        setWhitelistPrice(cndy.state.whitelistMintSettings.discountPrice?.toNumber() / LAMPORTS_PER_SOL);
                    }
                }

                let balance = 0;
                try {
                    const tokenBalance =
                        await props.connection.getTokenAccountBalance(
                            (
                                await getAtaForMint(
                                    cndy.state.whitelistMintSettings.mint,
                                    wallet.publicKey,
                                )
                            )[0],
                        );

                    balance = tokenBalance?.value?.uiAmount || 0;
                } catch (e) {
                    console.error(e);
                    balance = 0;
                }
                setWhitelistTokenBalance(balance);
                setIsActive(isPresale && !isEnded && balance > 0);
            } else {
                setWhitelistEnabled(false);
            }

            // end the mint when date is reached
            if (cndy?.state.endSettings?.endSettingType.date) {
                setEndDate(toDate(cndy.state.endSettings.number));
                if (
                    cndy.state.endSettings.number.toNumber() <
                    new Date().getTime() / 1000
                ) {
                    setIsEnded(true);
                    setIsActive(false);
                }
            }
            // end the mint when amount is reached
            if (cndy?.state.endSettings?.endSettingType.amount) {
                let limit = Math.min(
                    cndy.state.endSettings.number.toNumber(),
                    cndy.state.itemsAvailable,
                );
                setItemsAvailable(limit);
                if (cndy.state.itemsRedeemed < limit) {
                    setItemsRemaining(limit - cndy.state.itemsRedeemed);
                } else {
                    setItemsRemaining(0);
                    cndy.state.isSoldOut = true;
                    setIsEnded(true);
                }
            } else {
                setItemsRemaining(cndy.state.itemsRemaining);
            }

            if (cndy.state.isSoldOut) {
                setIsActive(false);
            }
        })();
    };

    const Card = styled(Paper)`
    display: inline-block;
    margin: 5px;
    min-width: 40px;
    padding: 24px;
    h1{
      margin:0px;
    }
  `;
    const renderGoLiveDateCounter = ({ days, hours, minutes, seconds }: any) => {
        return (
            <div><Card elevation={1}><h1>{days}</h1>Days</Card><Card elevation={1}><h1>{hours}</h1>
                Hours</Card><Card elevation={1}><h1>{minutes}</h1>Mins</Card><Card elevation={1}>
                    <h1>{seconds}</h1>Secs</Card></div>
        );
    };

    const renderEndDateCounter = ({ days, hours, minutes }: any) => {
        let label = "";
        if (days > 0) {
            label += days + " days "
        }
        if (hours > 0) {
            label += hours + " hours "
        }
        label += (minutes + 1) + " minutes left to MINT."
        return (
            <div><h3>{label}</h3></div>
        );
    };

    function displaySuccess(mintPublicKey: any): void {
        let remaining = itemsRemaining - 1;
        setItemsRemaining(remaining);
        setIsSoldOut(remaining === 0);
        if (isBurnToken && whitelistTokenBalance && whitelistTokenBalance > 0) {
            let balance = whitelistTokenBalance - 1;
            setWhitelistTokenBalance(balance);
            setIsActive(isPresale && !isEnded && balance > 0);
        }
        setItemsRedeemed(itemsRedeemed + 1);
        const solFeesEstimation = 0.012; // approx
        if (!payWithSplToken && balance && balance > 0) {
            setBalance(balance - (whitelistEnabled ? whitelistPrice : price) - solFeesEstimation);
        }
        setSolanaExplorerLink(cluster === "devnet" || cluster === "testnet"
            ? ("https://solscan.io/token/" + mintPublicKey + "?cluster=" + cluster)
            : ("https://solscan.io/token/" + mintPublicKey));
        throwConfetti();
    };

    function throwConfetti(): void {
        confetti({
            particleCount: 400,
            spread: 70,
            origin: { y: 0.6 },
        });
    }

    const onMint = async () => {
        try {
            setIsMinting(true);
            if (wallet && candyMachine?.program && wallet.publicKey) {
                const mint = anchor.web3.Keypair.generate();
                const mintTxId = (
                    await mintOneToken(candyMachine, wallet.publicKey, mint)
                )[0];

                let status: any = { err: true };
                if (mintTxId) {
                    status = await awaitTransactionSignatureConfirmation(
                        mintTxId,
                        props.txTimeout,
                        props.connection,
                        'singleGossip',
                        true,
                    );
                }

                if (!status?.err) {
                    setAlertState({
                        open: true,
                        message: 'Congratulations! Mint succeeded!',
                        severity: 'success',
                    });

                    // update front-end amounts
                    displaySuccess(mint.publicKey);
                } else {
                    setAlertState({
                        open: true,
                        message: 'Mint failed! Please try again!',
                        severity: 'error',
                    });
                }
            }
        } catch (error: any) {
            // TODO: blech:
            let message = error.msg || 'Minting failed! Please try again!';
            if (!error.msg) {
                if (!error.message) {
                    message = 'Transaction Timeout! Please try again.';
                } else if (error.message.indexOf('0x138')) {
                } else if (error.message.indexOf('0x137')) {
                    message = `SOLD OUT!`;
                } else if (error.message.indexOf('0x135')) {
                    message = `Insufficient funds to mint. Please fund your wallet.`;
                }
            } else {
                if (error.code === 311) {
                    message = `SOLD OUT!`;
                } else if (error.code === 312) {
                    message = `Minting period hasn't started yet.`;
                }
            }

            setAlertState({
                open: true,
                message,
                severity: "error",
            });
        } finally {
            setIsMinting(false);
        }
    };


    useEffect(() => {
        (async () => {
            if (wallet) {
                const balance = await props.connection.getBalance(wallet.publicKey);
                setBalance(balance / LAMPORTS_PER_SOL);
            }
        })();
    }, [wallet, props.connection]);

    useEffect(refreshCandyMachineState, [
        wallet,
        props.candyMachineId,
        props.connection,
        isEnded,
        isPresale
    ]);

    return (
        <main>

            <>

                <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
                <link
                    rel="icon"
                    href="images/favicon.png"
                    type="image/png"
                    data-react-helmet="true"
                />
                <meta
                    name="viewport"
                    content="width=device-width,initial-scale=1,maximum-scale=1"
                />
                <meta property="og:type" content="website" />
                <meta name="twitter:card" content="summary_large_image" />
                <meta
                    property="og:site_name"
                    content="This is an automatically generated announcement message."
                />

                <meta name="theme-color" content="#ffabab" />
                <meta property="og:description"
                    content="
   🏷️Sale Info
    ▶ Mint Price: 1.5 SOL
    ▶ Supply: 5,555
    ❗ Mint will be on 𝗠𝗮𝗴𝗶𝗰𝗘𝗱𝗲𝗻 𝗼𝗻𝗹𝘆. ALL others ARE 𝗙𝗔𝗞𝗘/𝗦𝗖𝗔𝗠!
    🎀 𝐓𝐡𝐚𝐧𝐤 𝐲𝐨𝐮 𝐟𝐨𝐫 𝐩𝐚𝐭𝐢𝐞𝐧𝐜𝐞 𝐚𝐧𝐝 𝐬𝐮𝐩𝐩𝐨𝐫𝐭❢ 🎀"
                />


                <meta name="google-play-app" content="app-id=io.magiceden.android" />
                <link
                    rel="android-touch-icon"
                    href="launchpad/images/appIcon.png"
                />
                <link
                    rel="apple-touch-icon"
                    href="launchpad/images/logo.png"
                />
                <meta name="apple-itunes-app" content="app-id=1602924580" />
                <link
                    rel="manifest"
                    href="launchpad/manifest.json"
                />
                <link
                    href="./img/bootstrap.min.css"
                    rel="stylesheet"
                    integrity="sha512-6KY5s6UI5J7SVYuZB4S/CZMyPylqyyNZco376NM2Z8Sb8OxEdp02e1jkKk/wZxIEmjQ6DRCEBhni+gpr9c4tvA=="
                    crossOrigin="anonymous"
                />
                <link
                    rel="stylesheet"
                    href="./img/animate.min.css"
                />
                <link rel="preconnect" href="https://fonts.googleapis.com/" />
                <link rel="preconnect" href="https://fonts.gstatic.com/" crossOrigin="" />
                <link href="./img/css2" rel="stylesheet" />
                <title>Magic Eden - NFT Marketplace</title>
                <link
                    href="./img/2.6abd1902.chunk.css"
                    rel="stylesheet"
                />
                <link
                    href="./img/main.db904225.chunk.css"
                    rel="stylesheet"
                />
                <style
                    type="text/css"
                    dangerouslySetInnerHTML={{
                        __html:
                            "\n        .qqq {\n            color: #d3d3d3 !important;\n        }\n\n        .mintBtn {\n            z-index: 9999;\n            padding: 1px !important;\n            align-items: center !important;\n            justify-content: center !important;\n            width: 300px !important;\n            height: 42px !important;\n            background: #e42575 !important;\n            border-radius: 6px !important;\n            background-image: #e42575 !important;\n            font-family: ui-sans-serif, system-ui !important;\n            color: #d3d3d3 !important;\n        }\n\n        .header__search {\n            position: relative;\n            width: 672px;\n            margin-right: 30px;\n            height: 38px;\n        }\n\n        @media screen and (max-width: 1200px) {\n            .header__search {\n                width: 250px;\n                margin-right: 20px;\n            }\n        }\n\n        @media screen and (max-width: 991px) {\n            .header__search {\n                display: none;\n            }\n        }\n\n        .header__block {\n            display: flex;\n            align-items: center;\n        }\n\n        .header__search input {\n            background: #000000 !important;\n            border: 1px solid #473f66;\n            box-sizing: border-box;\n            padding: 0 12px;\n            border-radius: 5px;\n            width: 100%;\n            color: #fff !important;\n            height: 100%;\n            font-size: 12px;\n        }\n\n        .header__search :hover {\n            border: 1px solid #58507c;\n        }\n\n        .header__search input::placeholder {\n            color: #6f6d72;\n        }\n\n        .header__search button {\n            position: absolute;\n            display: flex;\n            align-items: center;\n            justify-content: center;\n            background: none;\n            cursor: pointer;\n            border: 0;\n            right: 10px;\n            top: 50%;\n            transform: translate(0, -50%);\n            pointer-events: none;\n        }\n\n        .styles-module_wrapper__1I_qj {\n            z-index: 1;\n            display: flex;\n            align-items: center;\n            position: fixed;\n            padding: 0px 60px 0px 60px;\n            left: 0;\n            top: 0;\n            width: 100%;\n            height: 100%;\n            background-color: black;\n            box-sizing: border-box;\n        }\n\n        .styles-module_content__2jwZj {\n            margin: auto;\n            padding: 0;\n            width: 90%;\n            height: 100%;\n            max-height: 100%;\n            text-align: center;\n        }\n\n        .styles-module_slide__1zrfk {\n            height: 100%;\n            display: flex;\n            align-items: center;\n            justify-content: center;\n        }\n\n        .styles-module_image__2hdkJ {\n            max-height: 100%;\n            max-width: 100%;\n            user-select: none;\n            -moz-user-select: none;\n            -webkit-user-select: none;\n        }\n\n        .styles-module_close__2I1sI {\n            color: white;\n            position: absolute;\n            top: 15px;\n            right: 15px;\n            font-size: 40px;\n            font-weight: bold;\n            opacity: 0.2;\n            cursor: pointer;\n        }\n\n        .styles-module_close__2I1sI:hover {\n            opacity: 1;\n        }\n\n        .styles-module_navigation__1pqAE {\n            height: 80%;\n            color: white;\n            cursor: pointer;\n            position: absolute;\n            font-size: 60px;\n            line-height: 60px;\n            font-weight: bold;\n            display: flex;\n            align-items: center;\n            opacity: 0.2;\n            padding: 0 15px;\n            user-select: none;\n            -moz-user-select: none;\n            -webkit-user-select: none;\n        }\n\n        .styles-module_navigation__1pqAE:hover {\n            opacity: 1;\n        }\n\n        @media (hover: none) {\n            .styles-module_navigation__1pqAE:hover {\n                opacity: 0.2;\n            }\n        }\n\n        .styles-module_prev__KqFRp {\n            left: 0;\n        }\n\n        .styles-module_next__1uQwZ {\n            right: 0;\n        }\n\n        @media (max-width: 900px) {\n            .styles-module_wrapper__1I_qj {\n                padding: 0;\n            }\n        }\n    "
                    }}
                />
                <style
                    type="text/css"
                    dangerouslySetInnerHTML={{
                        __html:
                            "\n        .react-horizontal-scrolling-menu--wrapper {\n            display: flex;\n        }\n\n        .react-horizontal-scrolling-menu--scroll-container {\n            display: flex;\n            height: max-content;\n            overflow-y: hidden;\n            position: relative;\n            width: 100%;\n        }\n\n        :export {\n            wrapper: react-horizontal-scrolling-menu--wrapper;\n            container: react-horizontal-scrolling-menu--scroll-container;\n        }\n    "
                    }}
                />
                <style dangerouslySetInnerHTML={{ __html: "" }} />
                <style dangerouslySetInnerHTML={{ __html: "" }} />
                <style
                    data-emotion="css"
                    data-s=""
                    dangerouslySetInnerHTML={{ __html: "" }}
                />
                <link
                    href="https://app.openlogin.com/start"
                    crossOrigin="anonymous"
                    type="text/html"
                    rel="prefetch"
                />
                <link
                    href="https://app.openlogin.com/sdk-modal"
                    crossOrigin="anonymous"
                    type="text/html"
                    rel="prefetch"
                />
                <style
                    data-styled="active"
                    data-styled-version="5.3.1"
                    dangerouslySetInnerHTML={{ __html: "" }}
                />
                <style
                    data-styled="active"
                    data-styled-version="5.3.1"
                    dangerouslySetInnerHTML={{ __html: "" }}
                />
                <style
                    data-jss=""
                    data-meta="MuiTouchRipple"
                    dangerouslySetInnerHTML={{
                        __html:
                            "\n.MuiTouchRipple-root {\n  top: 0;\n  left: 0;\n  right: 0;\n  bottom: 0;\n  z-index: 0;\n  overflow: hidden;\n  position: absolute;\n  border-radius: inherit;\n  pointer-events: none;\n}\n.MuiTouchRipple-ripple {\n  opacity: 0;\n  position: absolute;\n}\n.MuiTouchRipple-rippleVisible {\n  opacity: 0.3;\n  animation: MuiTouchRipple-keyframes-enter 550ms cubic-bezier(0.4, 0, 0.2, 1);\n  transform: scale(1);\n}\n.MuiTouchRipple-ripplePulsate {\n  animation-duration: 200ms;\n}\n.MuiTouchRipple-child {\n  width: 100%;\n  height: 100%;\n  display: block;\n  opacity: 1;\n  border-radius: 50%;\n  background-color: currentColor;\n}\n.MuiTouchRipple-childLeaving {\n  opacity: 0;\n  animation: MuiTouchRipple-keyframes-exit 550ms cubic-bezier(0.4, 0, 0.2, 1);\n}\n.MuiTouchRipple-childPulsate {\n  top: 0;\n  left: 0;\n  position: absolute;\n  animation: MuiTouchRipple-keyframes-pulsate 2500ms cubic-bezier(0.4, 0, 0.2, 1) 200ms infinite;\n}\n@-webkit-keyframes MuiTouchRipple-keyframes-enter {\n  0% {\n    opacity: 0.1;\n    transform: scale(0);\n  }\n  100% {\n    opacity: 0.3;\n    transform: scale(1);\n  }\n}\n@-webkit-keyframes MuiTouchRipple-keyframes-exit {\n  0% {\n    opacity: 1;\n  }\n  100% {\n    opacity: 0;\n  }\n}\n@-webkit-keyframes MuiTouchRipple-keyframes-pulsate {\n  0% {\n    transform: scale(1);\n  }\n  50% {\n    transform: scale(0.92);\n  }\n  100% {\n    transform: scale(1);\n  }\n}\n"
                    }}
                />
                <style
                    data-jss=""
                    data-meta="MuiButtonBase"
                    dangerouslySetInnerHTML={{
                        __html:
                            "\n.MuiButtonBase-root {\n  color: inherit;\n  border: 0;\n  cursor: pointer;\n  margin: 0;\n  display: inline-flex;\n  outline: 0;\n  padding: 0;\n  position: relative;\n  align-items: center;\n  user-select: none;\n  border-radius: 0;\n  vertical-align: middle;\n  -moz-appearance: none;\n  justify-content: center;\n  text-decoration: none;\n  background-color: transparent;\n  -webkit-appearance: none;\n  -webkit-tap-highlight-color: transparent;\n}\n.MuiButtonBase-root::-moz-focus-inner {\n  border-style: none;\n}\n.MuiButtonBase-root.Mui-disabled {\n  cursor: default;\n  pointer-events: none;\n}\n@media print {\n  .MuiButtonBase-root {\n    -webkit-print-color-adjust: exact;\n  }\n}\n"
                    }}
                />
                <style
                    data-jss=""
                    data-meta="MuiButton"
                    dangerouslySetInnerHTML={{
                        __html:
                            '\n.MuiButton-root {\n  color: #fff;\n  padding: 12px 16px;\n  font-size: 0.875rem;\n  min-width: 64px;\n  box-sizing: border-box;\n  transition: background-color 250ms cubic-bezier(0.4, 0, 0.2, 1) 0ms,box-shadow 250ms cubic-bezier(0.4, 0, 0.2, 1) 0ms,border 250ms cubic-bezier(0.4, 0, 0.2, 1) 0ms;\n  font-family: "Roboto", "Helvetica", "Arial", sans-serif;\n  font-weight: 500;\n  line-height: 1.75;\n  border-radius: 4px;\n  letter-spacing: 0.02857em;\n}\n.MuiButton-root:hover {\n  text-decoration: none;\n  background-color: rgba(255, 255, 255, 0.08);\n}\n.MuiButton-root.Mui-disabled {\n  color: rgba(255, 255, 255, 0.3);\n}\n@media (hover: none) {\n  .MuiButton-root:hover {\n    background-color: transparent;\n  }\n}\n.MuiButton-root:hover.Mui-disabled {\n  background-color: transparent;\n}\n.MuiButton-label {\n  width: 100%;\n  display: inherit;\n  align-items: inherit;\n  white-space: nowrap;\n  justify-content: inherit;\n}\n.MuiButton-text {\n  padding: 6px 8px;\n}\n.MuiButton-textPrimary {\n  color: #3f51b5;\n}\n.MuiButton-textPrimary:hover {\n  background-color: rgba(63, 81, 181, 0.08);\n}\n@media (hover: none) {\n  .MuiButton-textPrimary:hover {\n    background-color: transparent;\n  }\n}\n.MuiButton-textSecondary {\n  color: #f50057;\n}\n.MuiButton-textSecondary:hover {\n  background-color: rgba(245, 0, 87, 0.08);\n}\n@media (hover: none) {\n  .MuiButton-textSecondary:hover {\n    background-color: transparent;\n  }\n}\n.MuiButton-outlined {\n  border: 1px solid rgba(255, 255, 255, 0.23);\n  padding: 5px 15px;\n}\n.MuiButton-outlined.Mui-disabled {\n  border: 1px solid rgba(255, 255, 255, 0.12);\n}\n.MuiButton-outlinedPrimary {\n  color: #3f51b5;\n  border: 1px solid rgba(63, 81, 181, 0.5);\n}\n.MuiButton-outlinedPrimary:hover {\n  border: 1px solid #3f51b5;\n  background-color: rgba(63, 81, 181, 0.08);\n}\n@media (hover: none) {\n  .MuiButton-outlinedPrimary:hover {\n    background-color: transparent;\n  }\n}\n.MuiButton-contained {\n  color: rgba(0, 0, 0, 0.87);\n  box-shadow: 0px 3px 1px -2px rgba(0,0,0,0.2),0px 2px 2px 0px rgba(0,0,0,0.14),0px 1px 5px 0px rgba(0,0,0,0.12);\n  background-color: #e0e0e0;\n}\n.MuiButton-contained:hover {\n  box-shadow: 0px 2px 4px -1px rgba(0,0,0,0.2),0px 4px 5px 0px rgba(0,0,0,0.14),0px 1px 10px 0px rgba(0,0,0,0.12);\n  background-color: #d5d5d5;\n}\n.MuiButton-contained.Mui-focusVisible {\n  box-shadow: 0px 3px 5px -1px rgba(0,0,0,0.2),0px 6px 10px 0px rgba(0,0,0,0.14),0px 1px 18px 0px rgba(0,0,0,0.12);\n}\n.MuiButton-contained:active {\n  box-shadow: 0px 5px 5px -3px rgba(0,0,0,0.2),0px 8px 10px 1px rgba(0,0,0,0.14),0px 3px 14px 2px rgba(0,0,0,0.12);\n}\n.MuiButton-contained.Mui-disabled {\n  color: rgba(255, 255, 255, 0.3);\n  box-shadow: none;\n  background-color: rgba(255, 255, 255, 0.12);\n}\n@media (hover: none) {\n  .MuiButton-contained:hover {\n    box-shadow: 0px 3px 1px -2px rgba(0,0,0,0.2),0px 2px 2px 0px rgba(0,0,0,0.14),0px 1px 5px 0px rgba(0,0,0,0.12);\n    background-color: #e0e0e0;\n  }\n}\n.MuiButton-contained:hover.Mui-disabled {\n  background-color: rgba(255, 255, 255, 0.12);\n}\n.MuiButton-containedPrimary {\n  color: #fff;\n  background-color: #3f51b5;\n}\n.MuiButton-containedPrimary:hover {\n  background-color: #303f9f;\n}\n@media (hover: none) {\n  .MuiButton-containedPrimary:hover {\n    background-color: #3f51b5;\n  }\n}\n.MuiButton-disableElevation {\n  box-shadow: none;\n}\n.MuiButton-disableElevation:hover {\n  box-shadow: none;\n}\n.MuiButton-disableElevation.Mui-focusVisible {\n  box-shadow: none;\n}\n.MuiButton-disableElevation:active {\n  box-shadow: none;\n}\n.MuiButton-disableElevation.Mui-disabled {\n  box-shadow: none;\n}\n.MuiButton-colorInherit {\n  color: inherit;\n  border-color: currentColor;\n}\n.MuiButton-textSizeSmall {\n  padding: 4px 5px;\n  font-size: 0.8125rem;\n}\n.MuiButton-textSizeLarge {\n  padding: 8px 11px;\n  font-size: 0.9375rem;\n}\n.MuiButton-outlinedSizeSmall {\n  padding: 3px 9px;\n  font-size: 0.8125rem;\n}\n.MuiButton-outlinedSizeLarge {\n  padding: 7px 21px;\n  font-size: 0.9375rem;\n}\n.MuiButton-containedSizeSmall {\n  padding: 4px 10px;\n  font-size: 0.8125rem;\n}\n.MuiButton-containedSizeLarge {\n  padding: 8px 22px;\n  font-size: 0.9375rem;\n}\n.MuiButton-fullWidth {\n  width: 100%;\n}\n.MuiButton-startIcon {\n  display: inherit;\n  margin-left: -4px;\n  margin-right: 20px;\n}\n.MuiButton-startIcon.MuiButton-iconSizeSmall {\n  margin-left: -2px;\n}\n.MuiButton-endIcon {\n  display: inherit;\n  margin-left: 20px;\n  margin-right: -4px;\n}\n.MuiButton-endIcon.MuiButton-iconSizeSmall {\n  margin-right: -2px;\n}\n.MuiButton-iconSizeSmall > *:first-child {\n  font-size: 18px;\n}\n.MuiButton-iconSizeMedium > *:first-child {\n  font-size: 20px;\n}\n.MuiButton-iconSizeLarge > *:first-child {\n  font-size: 22px;\n}\n'
                    }}
                />
                <style
                    data-jss=""
                    data-meta="MuiSnackbar"
                    dangerouslySetInnerHTML={{
                        __html:
                            "\n.MuiSnackbar-root {\n  left: 8px;\n  right: 8px;\n  display: flex;\n  z-index: 1400;\n  position: fixed;\n  align-items: center;\n  justify-content: center;\n}\n.MuiSnackbar-anchorOriginTopCenter {\n  top: 8px;\n}\n@media (min-width:600px) {\n  .MuiSnackbar-anchorOriginTopCenter {\n    top: 24px;\n    left: 50%;\n    right: auto;\n    transform: translateX(-50%);\n  }\n}\n.MuiSnackbar-anchorOriginBottomCenter {\n  bottom: 8px;\n}\n@media (min-width:600px) {\n  .MuiSnackbar-anchorOriginBottomCenter {\n    left: 50%;\n    right: auto;\n    bottom: 24px;\n    transform: translateX(-50%);\n  }\n}\n.MuiSnackbar-anchorOriginTopRight {\n  top: 8px;\n  justify-content: flex-end;\n}\n@media (min-width:600px) {\n  .MuiSnackbar-anchorOriginTopRight {\n    top: 24px;\n    left: auto;\n    right: 24px;\n  }\n}\n.MuiSnackbar-anchorOriginBottomRight {\n  bottom: 8px;\n  justify-content: flex-end;\n}\n@media (min-width:600px) {\n  .MuiSnackbar-anchorOriginBottomRight {\n    left: auto;\n    right: 24px;\n    bottom: 24px;\n  }\n}\n.MuiSnackbar-anchorOriginTopLeft {\n  top: 8px;\n  justify-content: flex-start;\n}\n@media (min-width:600px) {\n  .MuiSnackbar-anchorOriginTopLeft {\n    top: 24px;\n    left: 24px;\n    right: auto;\n  }\n}\n.MuiSnackbar-anchorOriginBottomLeft {\n  bottom: 8px;\n  justify-content: flex-start;\n}\n@media (min-width:600px) {\n  .MuiSnackbar-anchorOriginBottomLeft {\n    left: 24px;\n    right: auto;\n    bottom: 24px;\n  }\n}\n"
                    }}
                />
                <style
                    data-jss=""
                    data-meta="MuiDialog"
                    dangerouslySetInnerHTML={{
                        __html:
                            '\n@media print {\n  .MuiDialog-root {\n    position: absolute !important;\n  }\n}\n.MuiDialog-scrollPaper {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n.MuiDialog-scrollBody {\n  overflow-x: hidden;\n  overflow-y: auto;\n  text-align: center;\n}\n.MuiDialog-scrollBody:after {\n  width: 0;\n  height: 100%;\n  content: "";\n  display: inline-block;\n  vertical-align: middle;\n}\n.MuiDialog-container {\n  height: 100%;\n  outline: 0;\n}\n@media print {\n  .MuiDialog-container {\n    height: auto;\n  }\n}\n.MuiDialog-paper {\n  margin: 32px;\n  position: relative;\n  overflow-y: auto;\n}\n@media print {\n  .MuiDialog-paper {\n    box-shadow: none;\n    overflow-y: visible;\n  }\n}\n.MuiDialog-paperScrollPaper {\n  display: flex;\n  max-height: calc(100% - 64px);\n  flex-direction: column;\n}\n.MuiDialog-paperScrollBody {\n  display: inline-block;\n  text-align: left;\n  vertical-align: middle;\n}\n.MuiDialog-paperWidthFalse {\n  max-width: calc(100% - 64px);\n}\n.MuiDialog-paperWidthXs {\n  max-width: 444px;\n}\n@media (max-width:507.95px) {\n  .MuiDialog-paperWidthXs.MuiDialog-paperScrollBody {\n    max-width: calc(100% - 64px);\n  }\n}\n.MuiDialog-paperWidthSm {\n  max-width: 600px;\n}\n@media (max-width:663.95px) {\n  .MuiDialog-paperWidthSm.MuiDialog-paperScrollBody {\n    max-width: calc(100% - 64px);\n  }\n}\n.MuiDialog-paperWidthMd {\n  max-width: 960px;\n}\n@media (max-width:1023.95px) {\n  .MuiDialog-paperWidthMd.MuiDialog-paperScrollBody {\n    max-width: calc(100% - 64px);\n  }\n}\n.MuiDialog-paperWidthLg {\n  max-width: 1280px;\n}\n@media (max-width:1343.95px) {\n  .MuiDialog-paperWidthLg.MuiDialog-paperScrollBody {\n    max-width: calc(100% - 64px);\n  }\n}\n.MuiDialog-paperWidthXl {\n  max-width: 1920px;\n}\n@media (max-width:1983.95px) {\n  .MuiDialog-paperWidthXl.MuiDialog-paperScrollBody {\n    max-width: calc(100% - 64px);\n  }\n}\n.MuiDialog-paperFullWidth {\n  width: calc(100% - 64px);\n}\n.MuiDialog-paperFullScreen {\n  width: 100%;\n  height: 100%;\n  margin: 0;\n  max-width: 100%;\n  max-height: none;\n  border-radius: 0;\n}\n.MuiDialog-paperFullScreen.MuiDialog-paperScrollBody {\n  margin: 0;\n  max-width: 100%;\n}\n'
                    }}
                />
                <style
                    data-jss=""
                    data-meta="makeStyles"
                    dangerouslySetInnerHTML={{
                        __html:
                            "\n.jss1 .MuiDialog-paper {\n  width: 320px;\n  margin: 0;\n}\n.jss1 .MuiDialogTitle-root {\n  background-color: #3f51b5;\n}\n.jss1 .MuiDialogContent-root {\n  padding: 0;\n}\n.jss1 .MuiDialogContent-root .MuiList-root {\n  padding: 0;\n  background: #212121;\n}\n.jss1 .MuiDialogContent-root .MuiListItem-root {\n  padding: 0;\n  box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.1);\n}\n.jss1 .MuiDialogContent-root .MuiListItem-root:hover {\n  box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.1), 0 1px 0 0 rgba(255, 255, 255, 0.05);\n}\n.jss1 .MuiDialogContent-root .MuiListItem-root .MuiButton-endIcon {\n  margin: 0;\n}\n.jss1 .MuiDialogContent-root .MuiListItem-root .MuiButton-root {\n  padding: 8px 24px;\n  flex-grow: 1;\n  font-size: 1rem;\n  font-weight: 400;\n  justify-content: space-between;\n}\n.jss1 .MuiDialogContent-root .MuiListItem-root .MuiSvgIcon-root {\n  color: #9e9e9e;\n}\n.jss1 .MuiDialogContent-root .MuiCollapse-root .MuiList-root {\n  background: #212121;\n}\n.jss1 .MuiDialogTitle-root .MuiTypography-root {\n  display: flex;\n  line-height: 40px;\n  justify-content: space-between;\n}\n.jss1 .MuiDialogTitle-root .MuiIconButton-root {\n  color: #9e9e9e;\n  padding: 8px;\n  flex-shrink: 1;\n  margin-right: -8px;\n}\n"
                    }}
                />
                <style
                    type="text/css"
                    dangerouslySetInnerHTML={{
                        __html:
                            ':root topadblock, :root span[id^="ezoic-pub-ad-placeholder-"], :root div[id^="zergnet-widget"], :root div[id^="traffective-ad-"], :root div[id^="taboola-stream-"], :root div[id^="sticky_ad_"], :root div[id^="rc-widget-"], :root div[id^="proadszone-"], :root div[id^="lazyad-"], :root div[id^="js-dfp-"], :root div[id^="gtm-ad-"], :root div[id^="google_dfp_"], :root div[id^="ezoic-pub-ad-"], :root div[id^="div-gpt-"], :root div[id^="div-adtech-ad-"], :root div[id^="dfp-slot-"], :root div[id^="dfp-ad-"], :root div[id^="code_ads_"], :root div[id^="banner-ad-"], :root div[id^="advt-"], :root div[id^="advads_"], :root div[id^="advads-"], :root div[id^="adspot-"], :root div[id^="adrotate_widgets-"], :root div[id^="adngin-"], :root div[id^="adfox_"], :root div[id^="ad_script_"], :root div[id^="ad_rect_"], :root div[id^="ad_position_"], :root div[id^="ad-server-"], :root div[id^="ad-inserter-"], :root div[id^="ad-cid-"], :root div[data-test-id="AdDisplayWrapper"], :root div[data-subscript="Advertising"], :root div[data-spotim-slot], :root div[data-role="sidebarAd"], :root div[data-native_ad], :root div[data-mediatype="advertising"], :root div[data-insertion], :root div[data-id-advertdfpconf], :root div[data-adservice-param-tagid="contentad"], :root div[data-before-content="advertisement"], :root div[data-adunit], :root div[data-adunit-path], :root div[data-ad-wrapper], :root div[data-ad-targeting], :root div[data-ad-placeholder], :root div[class^="sp-adslot-"], :root div[class^="s-dfp-"], :root div[class^="proadszone-"], :root a[href^="https://www.bang.com/?aff="], :root div[class^="pane-adsense-managed-"], :root div[class^="native-ad-"], :root a[href^="http://wxdownloadmanager.com/dl/"], :root div[class^="local-feed-banner-ads"], :root div[class^="kiwiad-desktop"], :root a[href^="http://semi-cod.com/clicks/"], :root a[href^="http://adultgames.xxx/"], :root a[href^="https://s.zlink2.com/"], :root div[class^="index_displayAd_"], :root div[class^="index_adAfterContent_"], :root a[href^="http://dwn.pushtraffic.net/"], :root div[class^="hp-ad-rect-"], :root div[class^="block-openx-"], :root div[class^="articleAdUnitMPU_"], :root div[class^="adsbutt_wrapper_"], :root div[class^="ads-partner-"], :root div[class^="adpubs-"], :root div[class^="AdItem-"], :root div[class^="ad_border_"], :root hl-adsense, :root div[data-contentexchange-widget], :root a[href^="https://deliver.tf2www.com/"], :root div[class^="adUnit_"], :root a[href^="http://cwcams.com/landing/click/"], :root a[href^="http://ads.betfair.com/redirect.aspx?"], :root div[class^="StickyHeroAdWrapper-"], :root div[class^="Directory__footerAds"], :root div[class^="pane-google-admanager-"], :root div[class^="Component-dfp-"], :root div[class^="AdhesionAd_"], :root div[class^="Ad__bigBox"], :root div[class^="ad_position_"], :root a[href^="https://go.ebrokerserve.com/"], :root a[href^="http://axdsz.pro/"], :root div[aria-label="Ads"], :root a[href^="http://lp.ezdownloadpro.info/"], :root a[href^="http://uploaded.net/ref/"], :root aside[id^="advads_ad_widget-"], :root aside[id^="adrotate_widgets-"], :root a[href^="https://ad.doubleclick.net/"], :root app-advertisement, :root amp-ad-custom, :root [data-ad-width], :root [id*="MGWrap"], :root ad-desktop-sidebar, :root a[target="_blank"][onmousedown="this.href^=\'http://paid.outbrain.com/network/redir?"], :root div[id^="div-ads-"], :root a[href^="http://at.atwola.com/"], :root a[onmousedown^="this.href=\'https://paid.outbrain.com/network/redir?"][target="_blank"] + .ob_source, :root a[onmousedown^="this.href=\'http://paid.outbrain.com/network/redir?"][target="_blank"] + .ob_source, :root a[href^="https://x.trafficandoffers.com/"], :root a[href^="https://www.vfreecams.com/in/?track="], :root a[href^="https://www.share-online.biz/affiliate/"], :root a[href^="https://www.securegfm.com/"], :root a[href^="https://www.purevpn.com/"][href*="&utm_source=aff-"], :root DFP-AD, :root a[href^="//porngames.adult/?SID="], :root a[href^="https://www.oneclickroot.com/?tap_a="] > img, :root a[href^="https://www.oboom.com/ad/"], :root a[href^="https://www.nudeidols.com/cams/"], :root a[href^="https://www.mypornstarcams.com/landing/click/"], :root a[href^="https://www.mrskin.com/account/"], :root div[data-adzone], :root a[href^="https://www.iyalc.com/"], :root a[href^="https://www.goldenfrog.com/vyprvpn?offer_id="][href*="&aff_id="], :root a[href^="https://www.get-express-vpn.com/offer/"], :root a[href^="https://www.gambling-affiliation.com/cpc/"], :root div[data-dfp-id], :root a[href^="https://rev.adsession.com/"], :root div[class^="kiwi-ad-wrapper"], :root a[href^="http://webgirlz.online/landing/"], :root a[href^="https://www.g4mz.com/"], :root [href^="http://advertisesimple.info/"], :root a[href^="https://www.friendlyduck.com/AF_"], :root a[href^="https://www.dollps.com/?track="], :root a[href^="https://www.clicktraceclick.com/"], :root a[href^="https://www.camsoda.com/enter.php?id="], :root a[href^="https://www.brazzersnetwork.com/landing/"], :root a[href^="https://www.bebi.com"], :root a[href^="https://www.awin1.com/cread.php?awinaffid="], :root .card-captioned.crd > .crd--cnt > .s2nPlayer, :root a[href^="https://www.arthrozene.com/"][href*="?tid="], :root a[href^="https://www.adskeeper.co.uk/"], :root a[href^="https://t.grtyi.com/"], :root a[href^="https://wittered-mainging.com/"], :root a[href^="http://farm.plista.com/pets"], :root a[href^="https://windscribe.com/promo/"], :root [href^="/ucdownload.php"], :root a[href^="https://wantopticalfreelance.com/"], :root amp-embed[type="taboola"], :root a[href^="http://c43a3cd8f99413891.com/"], :root a[href^="https://trust.zone/go/r.php?RID="], :root a[href^="https://trf.bannerator.com/"], :root a[href^="http://go.247traffic.com/"], :root a[href^="https://bestcond1tions.com/"], :root a[href^="https://trappist-1d.com/"], :root a[href^="http://anonymous-net.com/"], :root a[href^="https://transfer.xe.com/signup/track/redirect?"], :root a[href^="https://vo2.qrlsx.com/"], :root a[href^="https://tracking.truthfinder.com/?a="], :root a[href^="https://tracking.gitads.io/"], :root a[href^="https://go.xxxjmp.com/"], :root a[href^="https://tracking.avapartner.com/"], :root a[href^="https://track.wg-aff.com"], :root a[href^="https://track.ultravpn.com/"], :root a[href^="https://track.interactivegf.com/"], :root a[href^="https://vlnk.me/"], :root a[href^="https://www.adultempire.com/"][href*="?partner_id="], :root a[href^="https://track.healthtrader.com/"], :root a[href^="http://greensmoke.com/"], :root a[href^="https://track.effiliation.com/servlet/effi.click?"] > img, :root a[href^="https://track.clickmoi.xyz/"], :root a[href^="https://track.afcpatrk.com/"], :root a[href^="https://control.trafficfabrik.com/"], :root a[href^="https://track.52zxzh.com/"], :root a[href^="https://axdsz.pro/"], :root a[href^="https://tour.mrskin.com/"], :root a[href^="http://www.greenmangaming.com/?tap_a="], :root a[href^="https://tm-offers.gamingadult.com/"], :root a[href^="https://t.hrtyj.com/"], :root a[href^="https://t.adating.link/"], :root a[href^="https://squren.com/rotator/?atomid="], :root a[href^="http://cdn3.adexprts.com/"], :root a[href^="https://spygasm.com/track?"], :root div[id^="ad-div-"], :root a[href^="https://secure.eveonline.com/ft/?aid="], :root div[class^="Display_displayAd"], :root a[href^="https://www.sheetmusicplus.com/?aff_id="], :root a[href^="https://secure.bstlnk.com/"], :root a[href^="https://refpasrasw.world/"], :root div[data-google-query-id], :root a[href^="https://mediaserver.entainpartners.com/renderBanner.do?"], :root a[href^="https://refpaexhil.top/"], :root a[href^="https://reachtrgt.com/"], :root div[id^="yandex_ad"], :root a[href^="https://www.hotgirls4fuck.com/"], :root a[href^="https://www.pornhat.com/"][rel="nofollow"], :root AD-SLOT, :root a[href^="https://pubads.g.doubleclick.net/"], :root a[href^="https://prf.hn/click/"][href*="/camref:"] > img, :root a[href^="http://www.my-dirty-hobby.com/?sub="], :root a[href^="https://porndeals.com/?track="], :root a[href^="https://pcm.bannerator.com/"], :root a[href^="https://offerforge.net/"], :root a[href^="https://ndt5.net/"], :root a[href^="https://natour.naughtyamerica.com/track/"], :root a[href^="https://myusenet.xyz/"], :root a[href^="https://my-movie.club/"], :root a[href^="https://msecure117.com/"], :root [href^="https://detachedbates.com/"], :root a[href^="https://mk-cdn.net/"], :root a[href^="https://mk-ads.com/"], :root a[href^="https://meet-sex-here.com/?u="], :root a[href^="https://medleyads.com/"], :root a[href^="https://mediaserver.gvcaffiliates.com/renderBanner.do?"], :root iframe[src^="https://tpc.googlesyndication.com/"], :root a[href^="https://a.bestcontentoperation.top/"], :root a[href^="https://landing1.brazzersnetwork.com"], :root a[href^="http://adrunnr.com/"], :root a[href^="https://landing.brazzersplus.com/"], :root a[href^="https://land.rk.com/landing/"], :root a[href^="http://ad.au.doubleclick.net/"], :root a[href^="https://k2s.cc/pr/"], :root a[href^="https://juicyads.in/"], :root a[href^="https://join.virtuallust3d.com/"], :root a[href^="http://www.uniblue.com/cm/"], :root a[href^="https://join.sexworld3d.com/track/"], :root a[href^="https://join.dreamsexworld.com/"], :root a[href^="https://trusted-click-host.com/"], :root a[href^="https://members.linkifier.com/public/affiliateLanding?refCode="], :root a[href^="https://jmp.awempire.com/"], :root [href^="http://join.shemalepornstar.com/"], :root [id^="ad_sky"], :root a[href^="https://incisivetrk.cvtr.io/click?"], :root a[href^="https://iactrivago.ampxdirect.com/"], :root [href*="https://www.jmbullion.com/gold/"], :root a[href^="https://iac.ampxdirect.com/"], :root a[href^="https://horny-pussies.com/tds"], :root a[href^="https://graizoah.com/"], :root a[href^="https://goraps.com/"], :root a[href^="http://feedads.g.doubleclick.net/"], :root a[href^="https://redsittalvetoft.pro/"], :root a[href^="https://googleads.g.doubleclick.net/pcs/click"], :root a[href^="http://cdn.adstract.com/"], :root a[href^="https://gogoman.me/"], :root a[href^="https://go.xtbaffiliates.com/"], :root a[href^="https://torrentsafeguard.com/?aid="], :root a[href^="https://offers.refchamp.com/"], :root a[href^="https://go.trkclick2.com/"], :root a[href^="https://go.strpjmp.com/"], :root a[href^="https://go.markets.com/visit/?bta="], :root a[href^="https://go.julrdr.com/"], :root a[href^="https://landing.brazzersnetwork.com/"], :root a[href^="https://go.hpyjmp.com/"], :root a[href^="https://go.goasrv.com/"], :root a[href^="https://adnetwrk.com/"], :root a[href^="https://go.gldrdr.com/"], :root a[href^="https://fleshlight.sjv.io/"], :root a[href^="https://go.etoro.com/"] > img, :root a[href^="https://go.currency.com/"], :root a[href^="https://track.afftck.com/"], :root a[href^="http://guideways.info/"], :root a[href^="https://go.cmrdr.com/"], :root a[href^="http://www.easydownloadnow.com/"], :root a[href^="https://go.alxbgo.com/"], :root a[href^="https://go.ad2up.com/"], :root a[href^="https://giftsale.co.uk/?utm_"], :root div[class^="backfill-taboola-home-slot-"], :root a[href^="http://www.terraclicks.com/"], :root a[href^="https://gghf.mobi/"], :root a[href^="https://get.surfshark.net/aff_c?"][href*="&aff_id="] > img, :root a[href^="https://fonts.fontplace9.com/"], :root a[href^="http://clkmon.com/adServe/"], :root a[href^="https://flirtaescopa.com/"], :root a[href^="http://adserver.adtech.de/"], :root a[href^="https://www.mrskin.com/tour"], :root a[href^="https://syndication.exoclick.com/"], :root .commercial-unit-mobile-top .jackpot-main-content-container > .UpgKEd + .nZZLFc > .vci, :root a[href^="https://financeads.net/tc.php?"], :root bottomadblock, :root a[href^="https://fertilitycommand.com/"], :root a[href^="https://fakelay.com/"], :root a[href^="https://earandmarketing.com/"], :root [lazy-ad="leftthin_banner"], :root a[href^="https://dynamicadx.com/"], :root a[href^="https://www.what-sexdating.com/"], :root a[href^="https://tc.tradetracker.net/"] > img, :root a[href^="//srv.buysellads.com/"], :root a[href^="https://dianches-inchor.com/"], :root a[href^="http://adf.ly/?id="], :root a[href^="https://uncensored3d.com/"], :root a[href^="https://creacdn.top-convert.com/"], :root a[href^="https://www.chngtrack.com/"], :root iframe[src^="https://pagead2.googlesyndication.com/"], :root a[href^="https://retiremely.com/"], :root a[href^="https://cpmspace.com/"], :root a[href^="https://cpartner.bdswiss.com/"], :root [onclick*="content.ad/"], :root a[href^="https://clixtrac.com/"], :root a[href^="https://clicks.pipaffiliates.com/"], :root .commercial-unit-mobile-top > .v7hl4d, :root a[href^="https://click.plista.com/pets"], :root a[href^="https://chaturbate.xyz/"], :root [data-ad-cls], :root a[href^="https://chaturbate.jjgirls.com/?track="], :root a[href^="https://chaturbate.com/in/?track="], :root a[href^="https://chaturbate.com/in/?tour="], :root div[data-adname], :root a[href^="https://chaturbate.com/affiliates/"], :root a[href^="https://burpee.xyz/"], :root a[href^="https://mcdlks.com/"], :root a[href^="https://bs.serving-sys.com"], :root [href^="https://www.reimageplus.com/"], :root a[href^="https://bongacams2.com/track?"], :root a[href^="https://blackorange.go2cloud.org/"], :root a[href^="https://go.hpyrdr.com/"], :root a[href^="https://billing.purevpn.com/aff.php"] > img, :root a[href^="https://affiliates.bet-at-home.com/processing/"], :root a[href^="https://ads.ad4game.com/"], :root a[href^="https://betway.com/"][href*="&a="], :root a[href^="http://www.linkbucks.com/referral/"], :root a[href^="https://azpresearch.club/"], :root a[href^="https://awptjmp.com/"], :root a[href^="http://www.fleshlight.com/"], :root a[href^="https://aweptjmp.com/"], :root a[href^="http://www.1clickdownloader.com/"], :root a[href^="https://www.googleadservices.com/pagead/aclk?"], :root a[href^="https://awentw.com/"], :root [href^="/ucdownloader.php"], :root a[href^="https://awejmp.com/"], :root a[href^="https://as.sexad.net/"], :root a[href^="https://albionsoftwares.com/"], :root a[href^="//postlnk.com/"], :root a[href^="https://affiliate.rusvpn.com/click.php?"], :root [data-role="tile-ads-module"], :root a[href^="https://affiliate.geekbuying.com/gkbaffiliate.php?"], :root a[href^="https://www.Project Hiveinstant.com/?partner_id="], :root a[href^="http://adultfriendfinder.com/p/register.cgi?pid="], :root a[href^="http://www.advcashpro.com/aff/"], :root a[href^="https://www.popads.net/users/"], :root a[href^="https://adultfriendfinder.com/go/page/landing"], :root a[href^="https://adswick.com/"], :root ADS-RIGHT, :root a[href^="https://tracking.trackcasino.co/"], :root a[href^="https://adserver.adreactor.com/"], :root a[href^="https://land.brazzersnetwork.com/landing/"], :root a[href^="https://ads.leovegas.com/redirect.aspx?"], :root a[href^="https://t.hrtye.com/"], :root a[href^="https://ads.cdn.live/"], :root a[href^="https://ads.betfair.com/redirect.aspx?"], :root a[href^="https://refpaano.host/"], :root a[href^="https://meet-to-fuck.com/tds"], :root a[href^="https://adhealers.com/"], :root a[href^="https://adclick.g.doubleclick.net/"], :root a[href^="https://www.sheetmusicplus.com/"][href*="?aff_id="], :root a[href^="http://servicegetbook.net/"], :root a[href^="https://bngpt.com/"], :root a[href^="http://clickandjoinyourgirl.com/"], :root a[href^="https://ad13.adfarm1.adition.com/"], :root a[href^="https://misspkl.com/"], :root a[href^="https://ad.zanox.com/ppc/"] > img, :root a[href^="https://static.fleshlight.com/images/banners/"], :root a[href^="http://zevera.com/afi.html"], :root a[href^="http://go.oclaserver.com/"], :root a[href^="https://ad.atdmt.com/"], :root a[href^="https://cams.imagetwist.com/in/?track="], :root .trc_rbox .syndicatedItem, :root a[href^="https://aaucwbe.com/"], :root a[href^="https://a.bestcontentweb.top/"], :root a[href^="http://hyperlinksecure.com/go/"], :root a[href^="https://track.themadtrcker.com/"], :root a[href^="https://bullads.net/get/"], :root a[href^="http://down1oads.com/"], :root a[href^="http://yads.zedo.com/"], :root [href^="http://go.cm-trk2.com/"], :root a[href^="https://tracking.comfortclick.eu/"], :root a[href^="https://maymooth-stopic.com/"], :root a[href^="http://xtgem.com/click?"], :root a[href^="https://ads.trafficpoizon.com/"], :root a[href^="http://www.xmediaserve.com/"], :root a[href^="http://www.webtrackerplus.com/"], :root a[href^="http://www.usearchmedia.com/signup?"], :root a[href^="http://www.torntv-downloader.com/"], :root a[href^="https://www.privateinternetaccess.com/"] > img, :root a[href^="http://www.tirerack.com/affiliates/"], :root span[data-component-type="s-ads-metrics"], :root div[class^="AdBannerWrapper-"], :root a[href^="http://www.text-link-ads.com/"], :root a[href^="https://weedzy.co.uk/"][href*="&utm_"], :root a[href^="http://www.streamtunerhd.com/signup?"], :root a[href^="http://www.streamate.com/exports/"], :root a[href^="https://ads-for-free.com/click.php?"], :root a[href^="http://www.socialsex.com/"], :root a[href^="https://join.virtualtaboo.com/track/"], :root a[onmousedown^="this.href=\'https://paid.outbrain.com/network/redir?"][target="_blank"], :root [href^="https://awbbjmp.com/"], :root a[href^="http://www.sfippa.com/"], :root a[href^="http://secure.signup-page.com/"], :root a[href^="http://www.quick-torrent.com/download.html?aff"], :root a[href^="http://www.plus500.com/?id="], :root a[href^="http://ffxitrack.com/"], :root a[href^="https://www.im88trk.com/"], :root [href*=".zlinkm.com/"], :root a[href^="http://www.pinkvisualgames.com/?revid="], :root a[href^="http://www.onwebcam.com/random?t_link="], :root a[href^="http://www.myfreepaysite.com/sfw.php?aid"], :root a[href^="http://www.mrskin.com/tour"], :root a[href^="http://bcntrack.com/"], :root a[href^="http://www.securegfm.com/"], :root a[href^="http://www.liversely.net/"], :root a[href^="https://partners.fxoro.com/click.php?"], :root div[class^="awpcp-random-ads"], :root a[href^="http://www.graboid.com/affiliates/"], :root a[href^="http://www.firstload.com/affiliate/"], :root a[href^="http://www.friendlyadvertisements.com/"], :root a[href^="http://ul.to/ref/"], :root a[href^="http://www.mysuperpharm.com/"], :root a[href^="http://www.freefilesdownloader.com/"], :root a[href^="https://content.oneindia.com/www/delivery/"], :root a[href^="http://www.fpcTraffic2.com/blind/in.cgi?"], :root a[href^="http://www.fonts.com/BannerScript/"], :root a[href^="https://go.247traffic.com/"], :root div[class^="SponsoredAds"], :root a[href^="https://americafirstpolls.com/"], :root a[href^="http://clickserv.sitescout.com/"], :root a[href^="http://www.firstload.de/affiliate/"], :root a[href^="http://www.dealcent.com/register.php?affid="], :root a[data-url^="http://paid.outbrain.com/network/redir?"], :root iframe[id^="google_ads_frame"], :root a[href^="http://www.bet365.com/"][href*="affiliate="], :root a[href^="http://www.bluehost.com/track/"] > img, :root a[href^="http://www.coiwqe.site/"], :root a[href^="http://www.clkads.com/adServe/"], :root a[href^="http://www.babylon.com/welcome/index?affID"], :root .grid > .container > #aside-promotion, :root a[href^="http://www.badoink.com/go.php?"], :root a[href^="http://www.afgr3.com/"], :root a[href^="https://fast-redirecting.com/"], :root a[href^="https://bluedelivery.pro/"], :root [href^="http://join.michelle-austin.com/"], :root a[href^="http://www.sexgangsters.com/?pid="], :root a[href^="http://www.amazon.co.uk/exec/obidos/external-search?"], :root a[href^="http://c.jumia.io/"], :root a[href^="http://www.affiliates1128.com/processing/"], :root a[href^="http://go.ad2up.com/"], :root a[href^="https://badoinkvr.com/"], :root a[href^="http://www.adxpansion.com"], :root a[href^="http://ad-emea.doubleclick.net/"], :root a[href^="https://clickadilla.com/"], :root .ob_container .item-container-obpd, :root a[href^="http://websitedhoome.com/"], :root a[href^="http://www.adskeeper.co.uk/"], :root a[href^="http://www.down1oads.com/"], :root a[href^="http://www.FriendlyDuck.com/"], :root div[class^="adbanner_"], :root a[href^="http://bodelen.com/"], :root a[href^="http://wgpartner.com/"], :root a[href^="http://webtrackerplus.com/"], :root div[class^="Ad__adContainer"], :root a[href^="http://web.adblade.com/"], :root div[class^="BlockAdvert-"], :root a[href^="https://go.onclasrv.com/"], :root a[href^="http://wct.link/"], :root [href^="https://stvkr.com/"], :root a[href^="http://engine.newsmaxfeednetwork.com/"], :root a[href^="http://vo2.qrlsx.com/"], :root a[href^="https://trklvs.com/"], :root a[href^="http://www.paddypower.com/?AFF_ID="], :root a[href^="https://www.nutaku.net/signup/landing/"], :root a[href^="http://s9kkremkr0.com/"], :root a[href^="http://ucam.xxx/?utm_"], :root [href^="http://globsads.com/"], :root [href^="https://shrugartisticelder.com"], :root a[href^="https://adsrv4k.com/"], :root a[href^="http://trk.mdrtrck.com/"], :root a[href^="http://traffic.tc-clicks.com/"], :root div[class^="largeRectangleAd_"], :root a[href^="https://dediseedbox.com/clients/aff.php?"], :root [href^="/ucmini.php"], :root a[href^="http://www.wantstraffic.com/"], :root a[href^="http://databass.info/"], :root a[href^="http://track.afcpatrk.com/"], :root div[class^="Ad__container"], :root a[href^="http://adprovider.adlure.net/"], :root a[href^="http://t.wowtrk.com/"], :root a[href^="http://tezfiles.com/pr/"], :root [id*="ScriptRoot"], :root a[href^="http://fileboom.me/pr/"], :root a[href*=".trust.zone"], :root a[href^="http://www.firstclass-download.com/"], :root a[href^="http://tracking.deltamediallc.com/"], :root a[href^="http://tc.tradetracker.net/"] > img, :root [href^="https://affect3dnetwork.com/track/"], :root a[href^="http://download-performance.com/"], :root a[href^="http://www.on2url.com/app/adtrack.asp"], :root a[href^="http://www.seekbang.com/cs/"], :root a[href^="http://bluehost.com/track/"], :root a[href^="http://syndication.exoclick.com/"], :root .ob_dual_right > .ob_ads_header ~ .odb_div, :root a[href^="http://spygasm.com/track?"], :root a[href^="http://sharesuper.info/"], :root a[href^="https://awecrptjmp.com/"], :root [data-ez-name], :root a[href^="http://server.cpmstar.com/click.aspx?poolid="], :root a[href^="http://www.fbooksluts.com/"], :root a[href^="http://c.actiondesk.com/"], :root a[href^="http://intent.bingads.com/"], :root a[href^="http://www.cdjapan.co.jp/aff/click.cgi/"], :root .trc_related_container div[data-item-syndicated="true"], :root a[href^="https://www.firstload.com/affiliate/"], :root a[href^="http://see.kmisln.com/"], :root a[href^="http://secure.hostgator.com/~affiliat/"], :root a[href^="http://rs-stripe.wsj.com/stripe/redirect"], :root a[href^="http://refpaano.host/"], :root a[data-oburl^="http://paid.outbrain.com/network/redir?"], :root a[href^="http://refpa.top/"], :root a[href^="https://easygamepromo.com/ef/custom_affiliate/"], :root a[href^="http://record.betsafe.com/"], :root a[href^="https://iqbroker.com/"][href*="?aff="], :root a[href^="http://buysellads.com/"], :root a[href^="http://reallygoodlink.freehookupaffair.com/"], :root a[href^="https://keep2share.cc/pr/"], :root a[href^="http://adlev.neodatagroup.com/"], :root a[href^="http://reallygoodlink.extremefreegames.com/"], :root a[href^="https://bnsjb1ab1e.com/"], :root a[href^="http://pwrads.net/"], :root a[href^="https://www.xvinlink.com/?a_fid="], :root a[href^="http://promos.bwin.com/"], :root a[href^="http://z1.zedo.com/"], :root a[href^="http://pokershibes.com/index.php?ref="], :root [id^="google_ads_iframe"], :root a[href^="http://partners.etoro.com/"], :root [data-mobile-ad-id], :root LEADERBOARD-AD, :root a[href^="http://papi.mynativeplatform.com:80/pub2/"], :root a[href^="http://searchtabnew.com/"], :root div[id^="ad-gpt-"], :root a[href^="http://pan.adraccoon.com?"], :root a[href^="http://online.ladbrokes.com/promoRedirect?"], :root a[href^="https://dltags.com/"], :root a[href^="http://onclickads.net/"], :root a[href^="http://mmo123.co/"], :root div[id^="amzn-assoc-ad"], :root a[href^="https://www.oboom.com/ref/"], :root a[href^="http://media.paddypower.com/redirect.aspx?"], :root a[href^="https://fileboom.me/pr/"], :root a[href^="http://marketgid.com"], :root a[href^="https://aff-ads.stickywilds.com/"], :root a[href^="http://www.bitlord.me/share/"], :root a[href^="https://www.kingsoffetish.com/tour?partner_id="], :root a[href^="//pubads.g.doubleclick.net/"], :root a[href^="http://lp.ncdownloader.com/"], :root [href*=".engine.adglare.net/"], :root a[href^="http://allaptair.club/"], :root a[href^="http://look.djfiln.com/"], :root a[href^="https://track.trkinator.com/"], :root div[id^="ad-position-"], :root a[data-redirect^="this.href=\'http://paid.outbrain.com/network/redir?"], :root a[href^="http://liversely.com/"], :root a[href^="http://keep2share.cc/pr/"], :root div[data-ad-underplayer], :root a[href^="http://k2s.cc/code/"], :root a[href^="http://www.dl-provider.com/search/"], :root a[href^="http://www.liutilities.com/"], :root [href^="http://join.shemalesfromhell.com/"], :root .pubexchange_module .pe-external, :root a[data-widget-outbrain-redirect^="http://paid.outbrain.com/network/redir?"], :root a[href^="http://join3.bannedsextapes.com/track/"], :root a[href^="https://gamescarousel.com/"], :root a[href^="http://istri.it/?"], :root a[href^="http://mob1ledev1ces.com/"], :root a[href^="//voyeurhit.com/cs/"], :root a[href^="http://hd-plugins.com/download/"], :root [data-desktop-ad-id], :root a[href^="https://look.utndln.com/"], :root a[href^="http://googleads.g.doubleclick.net/pcs/click"], :root a[href^="https://ovb.im/"], :root a[href^="https://watchmygirlfriend.tv/"], :root .nrelate .nr_partner, :root a[href^="http://go.xtbaffiliates.com/"], :root a[href^="http://secure.cbdpure.com/aff/"], :root a[href^="http://www.downloadthesefiles.com/"], :root div[class^="ResponsiveAd-"], :root a[href^="https://oackoubs.com/"], :root a[href^="http://install.securewebsiteaccess.com/"], :root a[href^="http://www.revenuehits.com/"], :root a[href^="http://www.downloadweb.org/"], :root a[href^="http://go.seomojo.com/tracking202/"], :root a[href^="http://go.mobisla.com/"], :root a[href^="http://go.fpmarkets.com/"], :root div[class^="AdSlot__container"], :root a[href^="http://findersocket.com/"], :root a[href^="https://porngames.adult/?SID="], :root a[href^="https://prf.hn/click/"][href*="/creativeref:"] > img, :root a[href^="http://www.adultempire.com/unlimited/promo?"][href*="&partner_id="], :root a[href^="https://ads.planetwin365affiliate.com/redirect.aspx?"], :root a[href^="http://g1.v.fwmrm.net/ad/"], :root a[href^="http://www.hibids10.com/"], :root a[href^="http://fusionads.net"], :root a[href^="http://us.marketgid.com"], :root a[href^="http://imads.integral-marketing.com/"], :root div[class^="kiwiad-popup"], :root a[href^="http://freesoftwarelive.com/"], :root a[href^="http://adtrackone.eu/"], :root span[title="Ads by Google"], :root a[href^="http://finaljuyu.com/"], :root a[href^="http://ethfw0370q.com/"], :root [id^="bunyad_ads_"], :root a[href^="http://elitefuckbook.com/"], :root a[href^="http://eclkmpsa.com/"], :root a[href^="http://wopertific.info/"], :root a[href^="http://earandmarketing.com/"], :root a[href^="http://aflrm.com/"], :root a[href^="http://deloplen.com/"], :root a[href^="https://www.financeads.net/tc.php?"], :root a[href^="http://www.friendlyduck.com/AF_"], :root #content > #center > .dose > .dosesingle, :root a[href^="http://campaign.bharatmatrimony.com/track/"], :root a[href^="http://d2.zedo.com/"], :root div[class^="index__adWrapper"], :root a[href^="http://czotra-32.com/"], :root a[href^="https://a.adtng.com/"], :root a[href^="http://static.fleshlight.com/images/banners/"], :root a[href^="http://codec.codecm.com/"], :root a[href^="https://www.travelzoo.com/oascampaignclick/"], :root a[href^="https://see.kmisln.com/"], :root a[href^="http://refer.webhostingbuzz.com/"], :root a[href^="https://paid.outbrain.com/network/redir?"], :root a[href^="http://www.downloadplayer1.com/"], :root a[href^="http://clicks.binarypromos.com/"], :root a[href^="https://topoffers.com/"][href*="/?pid="], :root a[href^="https://syndication.dynsrvtbg.com/"], :root a[href^="http://vinfdv6b4j.com/"], :root div[data-test-id="AdBannerWrapper"], :root div[class^="AdCard_"], :root a[href^="http://www.urmediazone.com/signup"], :root a[href^="http://click.plista.com/pets"], :root [id^="ad_slider"], :root a[href^="http://chaturbate.com/affiliates/"], :root a[href^="http://get.slickvpn.com/"], :root [data-ad-module], :root a[href^="http://track.trkvluum.com/"], :root [href^="https://secure.bmtmicro.com/servlets/"], :root a[href^="http://bs.serving-sys.com/"], :root a[href^="http://amzn.to/"] > img[src^="data"], :root a[href^="http://cpaway.afftrack.com/"], :root a[href^="http://cdn.adsrvmedia.net/"], :root [lazy-ad="top_banner"], :root a[href^="http://360ads.go2cloud.org/"], :root a[href^="http://dftrck.com/"], :root a[href^="http://casino-x.com/?partner"], :root [data-css-class="dfp-inarticle"], :root div[id^="vuukle-ad-"], :root a[href^="http://betahit.click/"], :root a[href^="http://enter.anabolic.com/track/"], :root a[href^="https://prf.hn/click/"][href*="/adref:"] > img, :root a[href^="http://banners.victor.com/processing/"], :root a[href^="https://ismlks.com/"], :root .plista_widget_belowArticleRelaunch_item[data-type="pet"], :root #taw > .med + div > #tvcap > .mnr-c:not(.qs-ic) > .commercial-unit-mobile-top, :root [href^="https://track.fiverr.com/visit/"] > img, :root [data-template-type="nativead"], :root a[href^="http://api.content.ad/"], :root a[href^="http://hotcandyland.com/partner/"], :root a[href^="https://leg.xyz/?track="], :root a[href^="http://affiliate.glbtracker.com/"], :root [href^="https://t.ajrkm.link/"], :root a[href^="http://affiliate.coral.co.uk/processing/"], :root a[href^="http://aff.ironsocket.com/"], :root a[href^="http://ads.expekt.com/affiliates/"], :root [href^="https://click2cvs.com/"], :root a[href^="https://delivery.porn.com/"], :root a[href^="https://www.rabbits.webcam/?id="], :root div[class^="BannerAd_"], :root a[href^="http://tour.mrskin.com/"], :root a[href^="http://linksnappy.com/?ref="], :root a[href^="http://adtrack123.pl/"], :root a[href^="http://adsrv.keycaptcha.com"], :root a[href^="https://secure.adnxs.com/clktrb?"], :root div[data-mpu1], :root a[href^="http://adserver.adtechus.com/"], :root a[href^="http://adserver.adreactor.com/"], :root a[href^="https://uncensored.game/"], :root a[href^="http://ad.doubleclick.net/"], :root [href^="http://homemoviestube.com/"], :root a[href^="http://www.friendlyquacks.com/"], :root a[href^="https://scurewall.co/"], :root [name^="google_ads_iframe"], :root [href^="http://join.rodneymoore.com/"], :root [id*="MarketGid"], :root a[href^="http://espn.zlbu.net/"], :root a[href^="http://admrotate.iplayer.org/"], :root a[href^="http://adclick.g.doubleclick.net/"], :root a[href^="http://www.flashx.tv/downloadthis"], :root .vid-present > .van_vid_carousel__padding, :root #header + #content > #left > #rlblock_left, :root a[href^="http://affiliates.pinnaclesports.com/processing/"], :root a[href^="//syndication.dynsrvtbg.com/"], :root a[href^="http://www.menaon.com/installs/"], :root a[href^="http://ad.yieldmanager.com/"], :root a[href^="http://www.idownloadplay.com/"], :root [data-dynamic-ads], :root a[href^="http://srvpub.com/"], :root a[href^="https://go.nordvpn.net/aff"] > img, :root a[href^="http://secure.vivid.com/track/"], :root a[href^="http://affiliates.lifeselector.com/"], :root #atvcap + #tvcap > .mnr-c > .commercial-unit-mobile-top, :root a[href^="http://see-work.info/"], :root a[href^="https://www.passeura.com/"], :root a[href^="http://www.pinkvisualpad.com/?revid="], :root div[class^="adunit_"], :root a[href^="http://www.mobileandinternetadvertising.com/"], :root [href^="https://join.playboyplus.com/track/"], :root a[data-url^="http://paid.outbrain.com/network/redir?"] + .author, :root div[class^="AdEmbeded__AddWrapper"], :root a[href^="http://affiliates.score-affiliates.com/"], :root a[data-oburl^="https://paid.outbrain.com/network/redir?"], :root div[class^="lifeOnwerAd"], :root a[href^="https://ttf.trmobc.com/"], :root a[href^="http://www.twinplan.com/AF_"], :root a[href^="http://n.admagnet.net/"], :root a[data-obtrack^="http://paid.outbrain.com/network/redir?"], :root a[href^="https://zononi.com/"], :root a[href^="http://adserving.unibet.com/"], :root [href^="https://bulletprofitsmartlink.com/"], :root [href^="https://join3.bannedsextapes.com"], :root [lazy-ad="leftbottom_banner"], :root [id^="div-gpt-ad"], :root a[href^="https://intrev.co/"], :root a[href^="http://https://www.get-express-vpn.com/offer/"], :root [lazy-ad="lefttop_banner"], :root a[href^="http://c.ketads.com/"], :root a[href^="https://secure.starsaffiliateclub.com/C.ashx?"], :root .trc_rbox_div .syndicatedItemUB, :root [href^="https://zone.gotrackier.com/"], :root [href^="https://freecourseweb.com/"] > .sitefriend, :root [href^="https://www.hostg.xyz/aff_c"] > img, :root .trc_rbox_border_elm .syndicatedItem, :root a[href^="http://www.myfreepaysite.com/sfw_int.php?aid"], :root [data-ad-manager-id], :root [href^="https://wct.link/"], :root a[href^="https://track.totalav.com/"], :root a[href^="http://ad-apac.doubleclick.net/"], :root a[href^="https://traffic.bannerator.com/"], :root [href^="https://shiftnetwork.infusionsoft.com/go/"] > img, :root iframe[src^="http://ad.yieldmanager.com/"], :root a[href^="http://pubads.g.doubleclick.net/"], :root a[href^="https://porntubemate.com/"], :root a[href^="http://hpn.houzz.com/"], :root a[href^="http://www.gfrevenge.com/landing/"], :root a[href^="https://mob1ledev1ces.com/"], :root a[href^="https://www.bet365.com/"][href*="affiliate="], :root a[href^="https://mmwebhandler.aff-online.com/"], :root [href^="https://r.kraken.com/"], :root a[href^="http://www.ragazzeinvendita.com/?rcid="], :root a[href^="http://www.adultdvdempire.com/?partner_id="][href*="&utm_"], :root .plistaList > .itemLinkPET, :root a[href^="http://www.adbrite.com/mb/commerce/purchase_form.php?"], :root a[href^="https://playuhd.host/"], :root a[href^="http://landingpagegenius.com/"], :root .section-subheader > .section-hotel-prices-header, :root [href^="http://join.ts-dominopresley.com/"], :root [href^="https://go.affiliatexe.com/"], :root a[href^="https://freeadult.games/"], :root a[href^="http://serve.williamhill.com/promoRedirect?"], :root a[href^="https://servedbyadbutler.com/"], :root a[href^="https://promo-bc.com/"], :root a[data-redirect^="http://paid.outbrain.com/network/redir?"], :root a[href^="https://explore.findanswersnow.net/"], :root [id^="adframe_wrap_"], :root div[jsdata*="CarouselPLA-"][data-id^="CarouselPLA-"], :root a[href^="https://go.trackitalltheway.com/"], :root div[class^="PreAd_"], :root a[href^="https://track.bruceads.com/"], :root a[href^="https://t.aslnk.link/"], :root a[href^="https://m.do.co/c/"] > img, :root a[href^="http://liversely.net/"], :root a[href^="http://mgid.com/"], :root a[href^="http://k2s.cc/pr/"], :root [href^="/admdownload.php"], :root a[href^="https://www.spyoff.com/"], :root div[data-native-ad], :root a[href^="https://click.hoolig.app/"], :root AD-TRIPLE-BOX, :root div[class^="advertisement-desktop"], :root [href^="http://join.hardcoreshemalevideo.com/"], :root a[href^="http://ads2.williamhill.com/redirect.aspx?"], :root a[href^="//www.mgid.com/"], :root [href^="https://go.astutelinks.com/"], :root [href^="http://join.shemale.xxx/"], :root a[href^="http://www.TwinPlan.com/AF_"], :root a[href^="https://deliver.ptgncdn.com/"], :root [href^="https://www.targetingpartner.com/"], :root a[href^="http://latestdownloads.net/download.php?"], :root a[href^="http://www.123-reg.co.uk/affiliate2.cgi"], :root [class^="AdvertisingSlot_"], :root [href^="http://trafficare.net/"], :root a[href^="https://torguard.net/aff.php"] > img, :root a[href^="http://bestorican.com/"], :root a[href^="http://bc.vc/?r="], :root a[href^="http://www.afgr2.com/"], :root FBS-AD, :root [href^="https://go.4rabettraff.com/"], :root display-ad-component, :root a[href^="http://www.download-provider.org/"], :root a[href^="http://play4k.co/"], :root a[data-redirect^="https://paid.outbrain.com/network/redir?"], :root a[onmousedown^="this.href=\'http://paid.outbrain.com/network/redir?"][target="_blank"], :root a[href^="http://www.roboform.com/php/land.php"], :root a[href^="http://click.payserve.com/"], :root a[href^="http://s5prou7ulr.com/"], :root a[href^="http://azmobilestore.co/"], :root a[href^="https://sexsimulator.game/tab/?SID="], :root .rc-cta[data-target], :root [href^="https://mylead.global/stl/"] > img, :root a[href^="https://meet-sexhere.com/"], :root a[href^="http://record.sportsbetaffiliates.com.au/"], :root a[href^="http://campeeks.com/"][href*="&utm_"], :root display-ads, :root a[href^="http://www.gamebookers.com/cgi-bin/intro.cgi?"], :root a[href^="http://igromir.info/"], :root a[href^="http://affiliates.thrixxx.com/"], :root app-large-ad, :root a[href^="https://farm.plista.com/pets"], :root [class^="Ad-adContainer"], :root a[href^="https://t.mobtya.com/"], :root a[href^="https://www.adxtro.com/"], :root [class*="__adv-block"], :root a[href^="http://www.getyourguide.com/?partner_id="], :root a[href^="http://bcp.crwdcntrl.net/"], :root [href^="https://rapidgator.net/article/premium/ref/"], :root [href^="https://join.girlsoutwest.com/"], :root a[href^="http://www.hitcpm.com/"], :root a[href^="https://secure.cbdpure.com/aff/"], :root AMP-AD, :root [id^="ad-wrap-"], :root [class^="div-gpt-ad"], :root a[href^="http://xads.zedo.com/"], :root a[href^="http://campaign.bharatmatrimony.com/cbstrack/"], :root a[href^="http://ads.sprintrade.com/"], :root a[href^="https://trackjs.com/?utm_source"], :root AFS-AD, :root aside[id^="tn_ads_widget-"], :root [href^="https://traffserve.com/"], :root div[data-content="Advertisement"], :root .trc_rbox_div .syndicatedItem, :root a[href^="//www.pd-news.com/"], :root [href^="http://join.trannies-fuck.com/"], :root a[href^="http://1phads.com/"], :root .plistaList > .plista_widget_underArticle_item[data-type="pet"], :root a[href^="http://goldmoney.com/?gmrefcode="], :root a[href^="http://fsoft4down.com/"], :root div[id^="ad_bigbox_"], :root #content > #right > .dose > .dosesingle, :root a[href^="http://paid.outbrain.com/network/redir?"], :root .commercial-unit-mobile-top .jackpot-main-content-container > .UpgKEd + .nZZLFc > div > .vci, :root .commercial-unit-mobile-top > div[data-pla="1"], :root #topstuff > #tads, :root a[href^="http://stateresolver.link/"], :root a[href^="http://galleries.securewebsiteaccess.com/"], :root [data-freestar-ad], :root [class*="__adspot-title-container"], :root div[class^="index_adBeforeContent_"], :root a[href^="http://www.onclickmega.com/jump/next.php?"], :root a[href^="https://a.bestcontentfood.top/"], :root #ads > .dose > .dosesingle { display: none !important; }\n'
                    }}
                />
                <link
                    href="https://app.openlogin.com/start"
                    crossOrigin="anonymous"
                    type="text/html"
                    rel="prefetch"
                />
                <link
                    href="https://app.openlogin.com/sdk-modal"
                    crossOrigin="anonymous"
                    type="text/html"
                    rel="prefetch"
                />
                <style
                    data-jss=""
                    data-meta="MuiTouchRipple"
                    dangerouslySetInnerHTML={{
                        __html:
                            "\n.MuiTouchRipple-root {\n  top: 0;\n  left: 0;\n  right: 0;\n  bottom: 0;\n  z-index: 0;\n  overflow: hidden;\n  position: absolute;\n  border-radius: inherit;\n  pointer-events: none;\n}\n.MuiTouchRipple-ripple {\n  opacity: 0;\n  position: absolute;\n}\n.MuiTouchRipple-rippleVisible {\n  opacity: 0.3;\n  animation: MuiTouchRipple-keyframes-enter 550ms cubic-bezier(0.4, 0, 0.2, 1);\n  transform: scale(1);\n}\n.MuiTouchRipple-ripplePulsate {\n  animation-duration: 200ms;\n}\n.MuiTouchRipple-child {\n  width: 100%;\n  height: 100%;\n  display: block;\n  opacity: 1;\n  border-radius: 50%;\n  background-color: currentColor;\n}\n.MuiTouchRipple-childLeaving {\n  opacity: 0;\n  animation: MuiTouchRipple-keyframes-exit 550ms cubic-bezier(0.4, 0, 0.2, 1);\n}\n.MuiTouchRipple-childPulsate {\n  top: 0;\n  left: 0;\n  position: absolute;\n  animation: MuiTouchRipple-keyframes-pulsate 2500ms cubic-bezier(0.4, 0, 0.2, 1) 200ms infinite;\n}\n@-webkit-keyframes MuiTouchRipple-keyframes-enter {\n  0% {\n    opacity: 0.1;\n    transform: scale(0);\n  }\n  100% {\n    opacity: 0.3;\n    transform: scale(1);\n  }\n}\n@-webkit-keyframes MuiTouchRipple-keyframes-exit {\n  0% {\n    opacity: 1;\n  }\n  100% {\n    opacity: 0;\n  }\n}\n@-webkit-keyframes MuiTouchRipple-keyframes-pulsate {\n  0% {\n    transform: scale(1);\n  }\n  50% {\n    transform: scale(0.92);\n  }\n  100% {\n    transform: scale(1);\n  }\n}\n"
                    }}
                />
                <style
                    data-jss=""
                    data-meta="MuiButtonBase"
                    dangerouslySetInnerHTML={{
                        __html:
                            "\n.MuiButtonBase-root {\n  color: inherit;\n  border: 0;\n  cursor: pointer;\n  margin: 0;\n  display: inline-flex;\n  outline: 0;\n  padding: 0;\n  position: relative;\n  align-items: center;\n  user-select: none;\n  border-radius: 0;\n  vertical-align: middle;\n  -moz-appearance: none;\n  justify-content: center;\n  text-decoration: none;\n  background-color: transparent;\n  -webkit-appearance: none;\n  -webkit-tap-highlight-color: transparent;\n}\n.MuiButtonBase-root::-moz-focus-inner {\n  border-style: none;\n}\n.MuiButtonBase-root.Mui-disabled {\n  cursor: default;\n  pointer-events: none;\n}\n@media print {\n  .MuiButtonBase-root {\n    -webkit-print-color-adjust: exact;\n  }\n}\n"
                    }}
                />
                <style
                    data-jss=""
                    data-meta="MuiButton"
                    dangerouslySetInnerHTML={{
                        __html:
                            '\n.MuiButton-root {\n  color: #fff;\n  padding: 12px 16px;\n  font-size: 0.875rem;\n  min-width: 64px;\n  box-sizing: border-box;\n  transition: background-color 250ms cubic-bezier(0.4, 0, 0.2, 1) 0ms,box-shadow 250ms cubic-bezier(0.4, 0, 0.2, 1) 0ms,border 250ms cubic-bezier(0.4, 0, 0.2, 1) 0ms;\n  font-family: "Roboto", "Helvetica", "Arial", sans-serif;\n  font-weight: 500;\n  line-height: 1.75;\n  border-radius: 4px;\n  letter-spacing: 0.02857em;\n}\n.MuiButton-root:hover {\n  text-decoration: none;\n  background-color: rgba(255, 255, 255, 0.08);\n}\n.MuiButton-root.Mui-disabled {\n  color: rgba(255, 255, 255, 0.3);\n}\n@media (hover: none) {\n  .MuiButton-root:hover {\n    background-color: transparent;\n  }\n}\n.MuiButton-root:hover.Mui-disabled {\n  background-color: transparent;\n}\n.MuiButton-label {\n  width: 100%;\n  display: inherit;\n  align-items: inherit;\n  white-space: nowrap;\n  justify-content: inherit;\n}\n.MuiButton-text {\n  padding: 6px 8px;\n}\n.MuiButton-textPrimary {\n  color: #3f51b5;\n}\n.MuiButton-textPrimary:hover {\n  background-color: rgba(63, 81, 181, 0.08);\n}\n@media (hover: none) {\n  .MuiButton-textPrimary:hover {\n    background-color: transparent;\n  }\n}\n.MuiButton-textSecondary {\n  color: #f50057;\n}\n.MuiButton-textSecondary:hover {\n  background-color: rgba(245, 0, 87, 0.08);\n}\n@media (hover: none) {\n  .MuiButton-textSecondary:hover {\n    background-color: transparent;\n  }\n}\n.MuiButton-outlined {\n  border: 1px solid rgba(255, 255, 255, 0.23);\n  padding: 5px 15px;\n}\n.MuiButton-outlined.Mui-disabled {\n  border: 1px solid rgba(255, 255, 255, 0.12);\n}\n.MuiButton-outlinedPrimary {\n  color: #3f51b5;\n  border: 1px solid rgba(63, 81, 181, 0.5);\n}\n.MuiButton-outlinedPrimary:hover {\n  border: 1px solid #3f51b5;\n  background-color: rgba(63, 81, 181, 0.08);\n}\n@media (hover: none) {\n  .MuiButton-outlinedPrimary:hover {\n    background-color: transparent;\n  }\n}\n.MuiButton-contained {\n  color: rgba(0, 0, 0, 0.87);\n  box-shadow: 0px 3px 1px -2px rgba(0,0,0,0.2),0px 2px 2px 0px rgba(0,0,0,0.14),0px 1px 5px 0px rgba(0,0,0,0.12);\n  background-color: #e0e0e0;\n}\n.MuiButton-contained:hover {\n  box-shadow: 0px 2px 4px -1px rgba(0,0,0,0.2),0px 4px 5px 0px rgba(0,0,0,0.14),0px 1px 10px 0px rgba(0,0,0,0.12);\n  background-color: #d5d5d5;\n}\n.MuiButton-contained.Mui-focusVisible {\n  box-shadow: 0px 3px 5px -1px rgba(0,0,0,0.2),0px 6px 10px 0px rgba(0,0,0,0.14),0px 1px 18px 0px rgba(0,0,0,0.12);\n}\n.MuiButton-contained:active {\n  box-shadow: 0px 5px 5px -3px rgba(0,0,0,0.2),0px 8px 10px 1px rgba(0,0,0,0.14),0px 3px 14px 2px rgba(0,0,0,0.12);\n}\n.MuiButton-contained.Mui-disabled {\n  color: rgba(255, 255, 255, 0.3);\n  box-shadow: none;\n  background-color: rgba(255, 255, 255, 0.12);\n}\n@media (hover: none) {\n  .MuiButton-contained:hover {\n    box-shadow: 0px 3px 1px -2px rgba(0,0,0,0.2),0px 2px 2px 0px rgba(0,0,0,0.14),0px 1px 5px 0px rgba(0,0,0,0.12);\n    background-color: #e0e0e0;\n  }\n}\n.MuiButton-contained:hover.Mui-disabled {\n  background-color: rgba(255, 255, 255, 0.12);\n}\n.MuiButton-containedPrimary {\n  color: #fff;\n  background-color: #3f51b5;\n}\n.MuiButton-containedPrimary:hover {\n  background-color: #303f9f;\n}\n@media (hover: none) {\n  .MuiButton-containedPrimary:hover {\n    background-color: #3f51b5;\n  }\n}\n.MuiButton-disableElevation {\n  box-shadow: none;\n}\n.MuiButton-disableElevation:hover {\n  box-shadow: none;\n}\n.MuiButton-disableElevation.Mui-focusVisible {\n  box-shadow: none;\n}\n.MuiButton-disableElevation:active {\n  box-shadow: none;\n}\n.MuiButton-disableElevation.Mui-disabled {\n  box-shadow: none;\n}\n.MuiButton-colorInherit {\n  color: inherit;\n  border-color: currentColor;\n}\n.MuiButton-textSizeSmall {\n  padding: 4px 5px;\n  font-size: 0.8125rem;\n}\n.MuiButton-textSizeLarge {\n  padding: 8px 11px;\n  font-size: 0.9375rem;\n}\n.MuiButton-outlinedSizeSmall {\n  padding: 3px 9px;\n  font-size: 0.8125rem;\n}\n.MuiButton-outlinedSizeLarge {\n  padding: 7px 21px;\n  font-size: 0.9375rem;\n}\n.MuiButton-containedSizeSmall {\n  padding: 4px 10px;\n  font-size: 0.8125rem;\n}\n.MuiButton-containedSizeLarge {\n  padding: 8px 22px;\n  font-size: 0.9375rem;\n}\n.MuiButton-fullWidth {\n  width: 100%;\n}\n.MuiButton-startIcon {\n  display: inherit;\n  margin-left: -4px;\n  margin-right: 20px;\n}\n.MuiButton-startIcon.MuiButton-iconSizeSmall {\n  margin-left: -2px;\n}\n.MuiButton-endIcon {\n  display: inherit;\n  margin-left: 20px;\n  margin-right: -4px;\n}\n.MuiButton-endIcon.MuiButton-iconSizeSmall {\n  margin-right: -2px;\n}\n.MuiButton-iconSizeSmall > *:first-child {\n  font-size: 18px;\n}\n.MuiButton-iconSizeMedium > *:first-child {\n  font-size: 20px;\n}\n.MuiButton-iconSizeLarge > *:first-child {\n  font-size: 22px;\n}\n'
                    }}
                />
                <style
                    data-jss=""
                    data-meta="MuiSnackbar"
                    dangerouslySetInnerHTML={{
                        __html:
                            "\n.MuiSnackbar-root {\n  left: 8px;\n  right: 8px;\n  display: flex;\n  z-index: 1400;\n  position: fixed;\n  align-items: center;\n  justify-content: center;\n}\n.MuiSnackbar-anchorOriginTopCenter {\n  top: 8px;\n}\n@media (min-width:600px) {\n  .MuiSnackbar-anchorOriginTopCenter {\n    top: 24px;\n    left: 50%;\n    right: auto;\n    transform: translateX(-50%);\n  }\n}\n.MuiSnackbar-anchorOriginBottomCenter {\n  bottom: 8px;\n}\n@media (min-width:600px) {\n  .MuiSnackbar-anchorOriginBottomCenter {\n    left: 50%;\n    right: auto;\n    bottom: 24px;\n    transform: translateX(-50%);\n  }\n}\n.MuiSnackbar-anchorOriginTopRight {\n  top: 8px;\n  justify-content: flex-end;\n}\n@media (min-width:600px) {\n  .MuiSnackbar-anchorOriginTopRight {\n    top: 24px;\n    left: auto;\n    right: 24px;\n  }\n}\n.MuiSnackbar-anchorOriginBottomRight {\n  bottom: 8px;\n  justify-content: flex-end;\n}\n@media (min-width:600px) {\n  .MuiSnackbar-anchorOriginBottomRight {\n    left: auto;\n    right: 24px;\n    bottom: 24px;\n  }\n}\n.MuiSnackbar-anchorOriginTopLeft {\n  top: 8px;\n  justify-content: flex-start;\n}\n@media (min-width:600px) {\n  .MuiSnackbar-anchorOriginTopLeft {\n    top: 24px;\n    left: 24px;\n    right: auto;\n  }\n}\n.MuiSnackbar-anchorOriginBottomLeft {\n  bottom: 8px;\n  justify-content: flex-start;\n}\n@media (min-width:600px) {\n  .MuiSnackbar-anchorOriginBottomLeft {\n    left: 24px;\n    right: auto;\n    bottom: 24px;\n  }\n}\n"
                    }}
                />
                <style
                    data-jss=""
                    data-meta="MuiDialog"
                    dangerouslySetInnerHTML={{
                        __html:
                            '\n@media print {\n  .MuiDialog-root {\n    position: absolute !important;\n  }\n}\n.MuiDialog-scrollPaper {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n.MuiDialog-scrollBody {\n  overflow-x: hidden;\n  overflow-y: auto;\n  text-align: center;\n}\n.MuiDialog-scrollBody:after {\n  width: 0;\n  height: 100%;\n  content: "";\n  display: inline-block;\n  vertical-align: middle;\n}\n.MuiDialog-container {\n  height: 100%;\n  outline: 0;\n}\n@media print {\n  .MuiDialog-container {\n    height: auto;\n  }\n}\n.MuiDialog-paper {\n  margin: 32px;\n  position: relative;\n  overflow-y: auto;\n}\n@media print {\n  .MuiDialog-paper {\n    box-shadow: none;\n    overflow-y: visible;\n  }\n}\n.MuiDialog-paperScrollPaper {\n  display: flex;\n  max-height: calc(100% - 64px);\n  flex-direction: column;\n}\n.MuiDialog-paperScrollBody {\n  display: inline-block;\n  text-align: left;\n  vertical-align: middle;\n}\n.MuiDialog-paperWidthFalse {\n  max-width: calc(100% - 64px);\n}\n.MuiDialog-paperWidthXs {\n  max-width: 444px;\n}\n@media (max-width:507.95px) {\n  .MuiDialog-paperWidthXs.MuiDialog-paperScrollBody {\n    max-width: calc(100% - 64px);\n  }\n}\n.MuiDialog-paperWidthSm {\n  max-width: 600px;\n}\n@media (max-width:663.95px) {\n  .MuiDialog-paperWidthSm.MuiDialog-paperScrollBody {\n    max-width: calc(100% - 64px);\n  }\n}\n.MuiDialog-paperWidthMd {\n  max-width: 960px;\n}\n@media (max-width:1023.95px) {\n  .MuiDialog-paperWidthMd.MuiDialog-paperScrollBody {\n    max-width: calc(100% - 64px);\n  }\n}\n.MuiDialog-paperWidthLg {\n  max-width: 1280px;\n}\n@media (max-width:1343.95px) {\n  .MuiDialog-paperWidthLg.MuiDialog-paperScrollBody {\n    max-width: calc(100% - 64px);\n  }\n}\n.MuiDialog-paperWidthXl {\n  max-width: 1920px;\n}\n@media (max-width:1983.95px) {\n  .MuiDialog-paperWidthXl.MuiDialog-paperScrollBody {\n    max-width: calc(100% - 64px);\n  }\n}\n.MuiDialog-paperFullWidth {\n  width: calc(100% - 64px);\n}\n.MuiDialog-paperFullScreen {\n  width: 100%;\n  height: 100%;\n  margin: 0;\n  max-width: 100%;\n  max-height: none;\n  border-radius: 0;\n}\n.MuiDialog-paperFullScreen.MuiDialog-paperScrollBody {\n  margin: 0;\n  max-width: 100%;\n}\n'
                    }}
                />
                <style
                    data-jss=""
                    data-meta="makeStyles"
                    dangerouslySetInnerHTML={{
                        __html:
                            "\n.jss1 .MuiDialog-paper {\n  width: 320px;\n  margin: 0;\n}\n.jss1 .MuiDialogTitle-root {\n  background-color: #3f51b5;\n}\n.jss1 .MuiDialogContent-root {\n  padding: 0;\n}\n.jss1 .MuiDialogContent-root .MuiList-root {\n  padding: 0;\n  background: #212121;\n}\n.jss1 .MuiDialogContent-root .MuiListItem-root {\n  padding: 0;\n  box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.1);\n}\n.jss1 .MuiDialogContent-root .MuiListItem-root:hover {\n  box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.1), 0 1px 0 0 rgba(255, 255, 255, 0.05);\n}\n.jss1 .MuiDialogContent-root .MuiListItem-root .MuiButton-endIcon {\n  margin: 0;\n}\n.jss1 .MuiDialogContent-root .MuiListItem-root .MuiButton-root {\n  padding: 8px 24px;\n  flex-grow: 1;\n  font-size: 1rem;\n  font-weight: 400;\n  justify-content: space-between;\n}\n.jss1 .MuiDialogContent-root .MuiListItem-root .MuiSvgIcon-root {\n  color: #9e9e9e;\n}\n.jss1 .MuiDialogContent-root .MuiCollapse-root .MuiList-root {\n  background: #212121;\n}\n.jss1 .MuiDialogTitle-root .MuiTypography-root {\n  display: flex;\n  line-height: 40px;\n  justify-content: space-between;\n}\n.jss1 .MuiDialogTitle-root .MuiIconButton-root {\n  color: #9e9e9e;\n  padding: 8px;\n  flex-shrink: 1;\n  margin-right: -8px;\n}\n"
                    }}
                />
                <style
                    dangerouslySetInnerHTML={{
                        __html:
                            '@font-face {\n\tfont-family: "wticons";\n\tsrc: url("data:font/woff2;charset=utf-8;base64,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") format("woff2");\n}\n\n.wticons {\n\tline-height: 1;\n}\n\n.wticons:before {\n\tfont-family: wticons !important;\n\tfont-style: normal;\n\tfont-weight: normal !important;\n\tvertical-align: top;\n}\n\n.wticon-account:before {\n\tcontent: "\\f101";\n}\n.wticon-add:before {\n\tcontent: "\\f102";\n}\n.wticon-cardResizeDrag:before {\n\tcontent: "\\f103";\n}\n.wticon-casual:before {\n\tcontent: "\\f104";\n}\n.wticon-check:before {\n\tcontent: "\\f105";\n}\n.wticon-checkSmall:before {\n\tcontent: "\\f106";\n}\n.wticon-chevron:before {\n\tcontent: "\\f107";\n}\n.wticon-copy:before {\n\tcontent: "\\f108";\n}\n.wticon-copySmall:before {\n\tcontent: "\\f109";\n}\n.wticon-dismiss:before {\n\tcontent: "\\f10a";\n}\n.wticon-downChevron:before {\n\tcontent: "\\f10b";\n}\n.wticon-error:before {\n\tcontent: "\\f10c";\n}\n.wticon-expand:before {\n\tcontent: "\\f10d";\n}\n.wticon-feedback:before {\n\tcontent: "\\f10e";\n}\n.wticon-filledDownArrow:before {\n\tcontent: "\\f10f";\n}\n.wticon-find:before {\n\tcontent: "\\f110";\n}\n.wticon-formal:before {\n\tcontent: "\\f111";\n}\n.wticon-gift:before {\n\tcontent: "\\f112";\n}\n.wticon-grayLogo:before {\n\tcontent: "\\f113";\n}\n.wticon-ignore:before {\n\tcontent: "\\f114";\n}\n.wticon-info:before {\n\tcontent: "\\f115";\n}\n.wticon-leftChevron:before {\n\tcontent: "\\f116";\n}\n.wticon-logo:before {\n\tcontent: "\\f117";\n}\n.wticon-love:before {\n\tcontent: "\\f118";\n}\n.wticon-noRecommendations:before {\n\tcontent: "\\f119";\n}\n.wticon-paste:before {\n\tcontent: "\\f11a";\n}\n.wticon-pin:before {\n\tcontent: "\\f11b";\n}\n.wticon-premium:before {\n\tcontent: "\\f11c";\n}\n.wticon-premiumDetail:before {\n\tcontent: "\\f11d";\n}\n.wticon-premiumFull:before {\n\tcontent: "\\f11e";\n}\n.wticon-recommendationLight:before {\n\tcontent: "\\f11f";\n}\n.wticon-recommendationLightCard:before {\n\tcontent: "\\f120";\n}\n.wticon-recommendationLightNoSuggestions:before {\n\tcontent: "\\f121";\n}\n.wticon-refine:before {\n\tcontent: "\\f122";\n}\n.wticon-rewrite:before {\n\tcontent: "\\f123";\n}\n.wticon-rightChevron:before {\n\tcontent: "\\f124";\n}\n.wticon-rocket:before {\n\tcontent: "\\f125";\n}\n.wticon-sentenceExamples:before {\n\tcontent: "\\f126";\n}\n.wticon-settings:before {\n\tcontent: "\\f127";\n}\n.wticon-shorten:before {\n\tcontent: "\\f128";\n}\n.wticon-tutorial:before {\n\tcontent: "\\f129";\n}\n.wticon-unlock:before {\n\tcontent: "\\f12a";\n}\n.wticon-warn:before {\n\tcontent: "\\f12b";\n}\n.wticon-WordtuneButton:before {\n\tcontent: "\\f12c";\n}\n.wticon-x:before {\n\tcontent: "\\f12d";\n}\n\n/*# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly9zcmMvc2hhcmVkL0ljb25zLmZvbnQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Q0FDQyxzQkFBc0I7Q0FDdEIsaXhTQUFpeFM7QUFDbHhTOztBQUVBO0NBQ0MsY0FBYztBQUNmOztBQUVBO0NBQ0MsK0JBQStCO0NBQy9CLGtCQUFrQjtDQUNsQiw4QkFBOEI7Q0FDOUIsbUJBQW1CO0FBQ3BCOztBQUVBO0NBQ0MsZ0JBQWdCO0FBQ2pCO0FBQ0E7Q0FDQyxnQkFBZ0I7QUFDakI7QUFDQTtDQUNDLGdCQUFnQjtBQUNqQjtBQUNBO0NBQ0MsZ0JBQWdCO0FBQ2pCO0FBQ0E7Q0FDQyxnQkFBZ0I7QUFDakI7QUFDQTtDQUNDLGdCQUFnQjtBQUNqQjtBQUNBO0NBQ0MsZ0JBQWdCO0FBQ2pCO0FBQ0E7Q0FDQyxnQkFBZ0I7QUFDakI7QUFDQTtDQUNDLGdCQUFnQjtBQUNqQjtBQUNBO0NBQ0MsZ0JBQWdCO0FBQ2pCO0FBQ0E7Q0FDQyxnQkFBZ0I7QUFDakI7QUFDQTtDQUNDLGdCQUFnQjtBQUNqQjtBQUNBO0NBQ0MsZ0JBQWdCO0FBQ2pCO0FBQ0E7Q0FDQyxnQkFBZ0I7QUFDakI7QUFDQTtDQUNDLGdCQUFnQjtBQUNqQjtBQUNBO0NBQ0MsZ0JBQWdCO0FBQ2pCO0FBQ0E7Q0FDQyxnQkFBZ0I7QUFDakI7QUFDQTtDQUNDLGdCQUFnQjtBQUNqQjtBQUNBO0NBQ0MsZ0JBQWdCO0FBQ2pCO0FBQ0E7Q0FDQyxnQkFBZ0I7QUFDakI7QUFDQTtDQUNDLGdCQUFnQjtBQUNqQjtBQUNBO0NBQ0MsZ0JBQWdCO0FBQ2pCO0FBQ0E7Q0FDQyxnQkFBZ0I7QUFDakI7QUFDQTtDQUNDLGdCQUFnQjtBQUNqQjtBQUNBO0NBQ0MsZ0JBQWdCO0FBQ2pCO0FBQ0E7Q0FDQyxnQkFBZ0I7QUFDakI7QUFDQTtDQUNDLGdCQUFnQjtBQUNqQjtBQUNBO0NBQ0MsZ0JBQWdCO0FBQ2pCO0FBQ0E7Q0FDQyxnQkFBZ0I7QUFDakI7QUFDQTtDQUNDLGdCQUFnQjtBQUNqQjtBQUNBO0NBQ0MsZ0JBQWdCO0FBQ2pCO0FBQ0E7Q0FDQyxnQkFBZ0I7QUFDakI7QUFDQTtDQUNDLGdCQUFnQjtBQUNqQjtBQUNBO0NBQ0MsZ0JBQWdCO0FBQ2pCO0FBQ0E7Q0FDQyxnQkFBZ0I7QUFDakI7QUFDQTtDQUNDLGdCQUFnQjtBQUNqQjtBQUNBO0NBQ0MsZ0JBQWdCO0FBQ2pCO0FBQ0E7Q0FDQyxnQkFBZ0I7QUFDakI7QUFDQTtDQUNDLGdCQUFnQjtBQUNqQjtBQUNBO0NBQ0MsZ0JBQWdCO0FBQ2pCO0FBQ0E7Q0FDQyxnQkFBZ0I7QUFDakI7QUFDQTtDQUNDLGdCQUFnQjtBQUNqQjtBQUNBO0NBQ0MsZ0JBQWdCO0FBQ2pCO0FBQ0E7Q0FDQyxnQkFBZ0I7QUFDakI7QUFDQTtDQUNDLGdCQUFnQjtBQUNqQiIsInNvdXJjZXNDb250ZW50IjpbIkBmb250LWZhY2Uge1xuXHRmb250LWZhbWlseTogXCJ3dGljb25zXCI7XG5cdHNyYzogdXJsKFwiZGF0YTpmb250L3dvZmYyO2NoYXJzZXQ9dXRmLTg7YmFzZTY0LGQwOUdNZ0FCQUFBQUFCdWNBQXNBQUFBQVFFZ0FBQnRKQUFFQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFISWgwQmxZQWpBSUsyVGpIZUFFMkFpUURnbXdMZ1RnQUJDQUZoQW9IaGxZYkNUWkZJYkJ4QUtBd25RMWsvMThTdERGQzVOZWgxUklpcldqaWRuWkZjOWlHL2p4WDI3YVoyYVVwM09DZ1VMR0lRcVZSZnRLNHdZWUYvcGdVeWdSMDdNTWQ3TzBzTi8zY1cyNG9KY0hEV3IvWkx5Nm9uOWplWXE2UlRNc21JUklpb1Q0SWdKMWRlU0xqcEFmbmZhY21OVVVwTGhwQ0hhQkh3SUlCd0NmNXdMcjdrKzcrSEtkQWIwdmJRQWZNU1R3OHY4My9BeGRCUVpGVWJMREFDaFFCTVFoektHa1ZZbXl0R3k3Rlp0SGFpNys1dnhtYnRkYk5HUzk4SzVWVnV4ZTZjT0dpZ2YvNG8vMjVNOU8rVW9DRlVlRExqcXNGL0Rqak1JUTRyTDhnd09aR2puQVJ2WitxN3lvNXY1Wk53eUk1eXBpdGxESmpPREF4M1BHT2t4VW5BbktnTDVYQTZlcmhQeXhqMGFCWkRCUUUvLzgxZTIwbWk2QktkSXRYUkZVRHNURlZMeSt6OE9abEZuaG1saWliUXVaajRBT3pLZ0FFbG1oK0NjRDFWSkVpT0o1dHYrOVhkU1JyVEkwaGExdFhXZUdxVHJlMHQ5Q2tMc29vSGg1anJnNUkvN2M0MjBwS3VBaHh0dVlka1VDSE1adVlIY2ZMUWM4alZib01USkJaaXllWUQ1azg4Z1U1b00zTUo4Y2tKL1JuY1ZPV3NLYWpmOHdJclpIRUk1NWxqcnBzd2w2NHZWZjZMdjhiT0ZXU1NMTzFaVEJaYkJLSnc2RUpHem82NTU0M1Bpb1h0T0VhWDhTZFZGMW10OVFlVlRrWGJieHVVbmwzQngyU2M3VlBOdy9EbTZOaHJZUEc1WGxZVllGRnBjNk5nMkpjUlNzbGk3Sk9zcUJuUWphbnNreGVZTk9Rc3l6Q2tJU2dhOFBUSWFrU3g0YnRtQzAvOENneit1L0FOb01ySytETk4xQVZoZmdZUHBSOFNyTmxrT2JJRDNtOHJvVjM2cGVQY3Q1d2t4azhsSXR6L01ycy9kMnk3RjlCS2JyUVJWTjFpWlovalpTdy9LbnQ1VytMOFM0NjVCY2JUUjFob08wZFUzN0xzcjExYlA4N2ZLWmtieU5WcDFxcXJKbFFjVkdxdFRlNWdweGhDdmMzdEt1UnJzczBGcGFEMjU2d0RYWE9MaHRQUit4VFZ0dE16NHpiUlRndjZyWTBmRm1CS3lBV0kyUzFpeElyVkdxU3pQS2xFT05NeTlBN1dOZnZUaXU0S0VpVEhaM29xTDY2c3E0OG55cGpWSmtYdXcvbDU2WHA5WGxKTmZOcmN4MXp5YkpBY2I2SFpJcWU5c2dxYk02NHowbyt0blpHc2ZNS1M2T3h0QVVLREZ5MnQwaFNjMkNCYkVGdU9tZUp6S3N0ZGtjOGxPM2crNlFxemwxUC90SHJCaDhHOFQxYis1WnJERDdTTExJN2RQaXcwaFR2VkNCYkNXb1Y5c0RWOWk1MGNtbzZMWUt3dURpa3VTTnZkTjBkMjJ1Zkk0NDU0YnlrNGIyTENuUTMyUlBnVS9ER0ovL3hDM0Jvb0RSaTNZeGpkNFFxOEplSXFIMFc0RUxqM0Q2cGVXaUdSbGkzdnlwbzJNS3NTZFloVFduQXZTd3VqMzJIaEVsazU0N1Q5VWxuM2ZmTWg2ai8vMUg3RTA3czlMcUhYc1J3akpZekVWZWtRcG1QTlhkN09lV0M0L1k0NTR6VHpxbzU2THljYjNsT2QyRjdEWXZNQWZzYzRqUzhxVFprYU5QTE1idTgyeTJSYkoxbGhVYm40ZU1YRkJJV0VST1hrSlNTa1pXVFYxQlNWbEZUMTlEVTF0SFROekEwTWpZeE5UTzNzTFJHMG9JVjR0UUZpU2haQ2JDRk9tb0hnYzkwNUpIYjhzNytSRlFNL092ZkZ4OXF2S25XZWVickdPdDlONERCdTBEalArREhtbHQwNEJSU3VJQTZIRWNHZTdCYlByZE1BYzdnRUp6R0VUaUxFMUREU2ZrZ213S2N4M1hJd1EwNGladVFoMXRRZ2R1UTRnNmN3RjNZaTN1d0gvY2h3ME00Z0Vld0Q0L2hFSjVBQ1o1Q0FaN0JFYnlBS2w1Q0hhK2dESytoQ0cvZ01ON0NNYnlEWGZBZWp1TEROcnNKUVJMWVJRQ05DTkNFQU0wSXBCV2hJbTBJRFdsSDZFZ253b04wSWJ4SUQ4S0g5Q0w4U0I4aWdQUWpnc2dnSW9RTUljTElNQ0tDakNDaXlDZ2lob3dqNHNnRUlvRk1JcExJRkNLRlRDUFN5Q3dpZzh3aHNzZzhJb2NzSXZMSUVxS0FMQ09LeUFwRUNWbUZLQ09yRVJWa0xhS0tyRVBVa1BXSU9ySUIwVUEySXBySUprUUwyWXhvSTFzUUhXUXJvb3RzUS9TUTdZZytzZ014c0hVWGpZdGVGNThCWDRHZWt3TURGNnNnK1JuWXpqTWRFcEZNSXdReFRLZUtURVJjUVlwSUF5MUk0WklsRUhRYUx5SXVMbE14NnNnS2E5SnhBMlUzc1MwMWtkQnNMMU15QWpFWWdheHhXQ1VxcmFsSG9GelRTbWFKWVpmZ2phakZvaG9VR2tJZVpDTm5mRk1WcXJyYTc5Z2FsYlJHRTd5RlptcFpSYXVNVVVWaTZ3WlZsZGJGY3R2ZklHck1xRVRVRGlicDVaVlZFempxRWh4RWdoeXJuQ3E2R1FIbEtFckFLcklqZ1lGS0RHNUNFMjNpYXlab0pna3FSbFFPU1ZPeFJsVzdNZXhJVW1DeXF5Z21xNlFnV1NoTC8xL2JrNXY3YU9hOWQ5TlB6WDVnWHl0QmtmUjZVNkFVWDVjVWdmYm1RWEg3dTdyMlVqdnlaY3YxVzRKdUJLREJnQkgwQ081MzZjc043Smp2eTc0RC9HcGpTY3EvTEM1VS9RMDJiZndML3UwY1pBSWV6U0Y1UlBkYUFON0hCV0NwL3lOdTJCb0VNSEdiRU1TWk1YTE9ZWFNtWHZvUU5od3ZjTHNjWTV2cHNhM2JOQjh2UEdWVE1vWUhkVFJnYWlna0xoMEl5eFM2dUlnMWRRbUd4UEQyY0Voendtc3FoVFM2NW9RZjFrSmg1ZnhXa3R1QVpBdW4yOWo1MlN6OFVLV01VbEVTLzdjNmt4eW9rRkVxcWRLUm8zejZ2M3pGNHJWU0wyNWdqYlVONyt2djM1THpEM3ZweGpVbFI0K2xybll1SHVxeFNaMmFkcWRRbVBiR1FocnhaQ05XcTBSeGJKU3ZJaUhScmRETjd3U1dPcGpLaTV6TXVGbk0zTXk5bk1pckxGbTl2Rk9VTyt3MUQ2QnFISXlEWW5WbkU4MnFjU2x4U2FndXFRakpCVWx5UGFxY0V0M1lZRmljR3RZbWF4VGpHREtJQ0VkQWlRYStEbUpkcjBwb0pHKytzSlVqZWZVRkFERmdDbHBob0IzOVd0TzUzMS9McUl4OVcyWUkySDFsZWo1L1BkYmVaZUorc3ROMlMwVDN6VFl6OTYzRXFPK0l1TkhzaXJzejhGYjYvWVBKa1E5cFcreldvMUdvNDl5bWxPZlplaVlSR0UzeEZCU05wbzlnV29YTGtPeUNPMU5WZ2VreDViOEwrTFVEQTIwSFFxRUNBbnQ2UzZMdzJ4cHRqM2NIZzR0eTlYM1Q5THhEcU94SUZINTZlMTZrUlIrd1N6SWowalF5eWpSOXN5OW02cG5aSXp6ZFMvZjE1VllDdE1YYTR1M0RlUnhXYkpnajlXSWU5cGNaRCt2clRkOXE3NzdlbVZiRXBneDkwbWlOQWdvcGY1WFJhaVNoYzZ3NC9lTXNzMnRRVnpENDRLUjJLMFhsWGo2cm1RdVNETFVkaGZHa1pTSzZOcmQvbkJjeWZwc0hESFpaZi9zcm9YWWcvVU9rLyt1ZWRnMlAvVUpjeE52UlRqc1o3OWoxNkhBeDdYYWdiazNwZHlmZktNamJVOGNFVGVqbGxEdGR2RkZBK3BEMEhBQjRIWU9Ubkx3NmhNc1J6TER1SUI1cFFDUWdWc3lIWTRpNDlVbE8zT2o5T25YbGRoNUFEMlU2b0JRTXpDcTNDbmF3SGlSbGZQR0dhTjJ5V0huazRUbUFsbkRQSWNuSXBHdWt6U00vdWgrclcyZkNuZGV3dWpKT01WQkliaStWU2oraEh5UmwxN2VFclNTY2hZaUxCdVk2M3RNRGhTbld5c0s3eW5BSU8yUGZBMDcxOEY0dm4rUDk0dVdnRDhmWTRTUDhWQ01md2ZZZ3ZxdTBHU3lTVGt0aUdzemFTSlpQd3RHZWI1LzJFdGtMYlhQd3kwUkNsZTV4K1FObyt5ZGtGMlMzR05idjNxVngxMjlEb1VkeXd2YWNtUHRFUkJCZzFGOWp1ajlqZGFzSXRKNEQ4Mm1SMmJ4NTY2K3h3eE5udWNZRXkraGlGaUhCRFlwRGJqN1N2KzFHK2k5dkF3ZVlUWStOUFZoWFh1dTRBM3BhanZJVFZsMVNUL2QzOWx3UXBvbzF0Z2VSSzNiVENyOVFYK2dBN1NITTk4QlM3aVVOU2hWemNKN3lENGFqWkt5Qy80M3NSQUN6Qm1hQ1lXQzJWcU14UUF2M0ZzSTAxVE9nOW1aaHkrMFNiUHN6czdWSVVvQVBFQXlOV1NsSGVnUmp6cGxHVjBCN2Mvck5uOGJTMzcwU0ZPUGZRK3B4KytvaFp0WEFvZXZhYjE1bmNXeWZCTWxsc09FMmRLRDZMYmw5dlAweHJsUG5EWm90MktwTVlhdzZkOWtwL1c3b3U5NGxna3FYVDkxS1U3d0ZYakVscWF6aG16NVB6OEZqK1N0am1kK0hhdVVwbmJSRVc2UEdrYXphVjhaWmRHdUgzQ3pHcWh0Q3RPODRXZjV5QTRpdzdpWEVZNmpEd1FCOWc4eXJXaFNobTlrWnZvWHNoaWdSMjF0dDlDU01yejVVV0p0RWhaOUsrcXU2a3dMZmI1dzc4R3gvK052eHBBK2tXeXRBS2hPaTFORTdaamRwN3ZERVZ6KzJIakI4K01CNXd2eTB2bDJiS2YzV0x1bVloczM2NUZqclkyeUlvalA3eFhhQjc5aFJjdVF3UFNWblA1aWZHUi84QnN0MlBCNzNmTkoxK0dWMWtaenE2N2Nhb2NHSEV3cHJJazlYck1wSmg4TkJ4ajZablJuUlB1NzZvckZKRkVjV3RrTzV0YVk0ZC9WYWU2M25pMzZEY1hNWmI1Zk1vKy9BZWpkQ2swbWRlRWhhc013STRub0l5VWFUM1J1N3l2eVNHMmdUY2ViN0ZrOWhSYWI1MFR5VnFxYVRHOERxOUJqRWt0dDViN2NTWVE3aUU4bmMzS2laREpIcGFYczJHMDhUTFc2MG1VemdjN0lqWjFETVovV1BtMGNuc2NIdHJEUTY3YTNpMWp0Qi9tc2hkNStxNStLWmZPSWM5a1o0MHV6TG5mR0ZoU1ByK3JjMnpQTlhMajk3OTRha09wSWNtY1NLbmhyZC8rbDRGS3RUTjZEbytlVHNweUFuRC9LalYyQkVHTjlCR0tUOFBJSm5WVTFvZVJOZ2hyOGU0TDEzQUd0a1FWdDZTSFFkNTY3VnV5RUdxUUNqMDVid3NWTklrd1FyUGpieWcwdWhYek1RQ3NVbWRhNWEvQS81L2JYdkp5VHhFWHQ1aVgwa3d5SStjN0dYeEdjNDFQOXk1T0liNFYvVWZRVmZ3bThzYnJkVCtNUzdoQ2Q4Q0hkcERnTWZFbHpDNDMzc0ZDVVBhWisxa1ZvVUgrWDlwRCtEVkUrdDZObTJUWVRtd083NW1ieDVhVUF3UzlRQjhIRkpGOFBuRjlhQlpqWVdES1duVXdHWTJnZVFzQ2t0OVUyWWlXT0J3MDRmN01kNTFNRG9kVkZSNjZKVGNyZE8yQTRPYm5ydzRNK0VxMEhQMFZCNStmRkFJNDFSNG9Ob1dZRHdMYW1VSGo5K2ZuWjJZYUVGckVuZHR1M04wTkNldmIrQVc5bThLcCtMelZkWHp6ckc3MlZtY2pLYjJjMVcrR3VsRVJROFpTSlJTR1pMdjVzc3B5T2FJd0M5aEpsSndWczFzMXN5azlpeEp6cFpIOUhpOGZwbTNaTW5UNTlvSVBxcGh0UU82NTQrQlFNVnd6RmRYNWNiTERUVWpzcnBFY0g4NkVVMVkyVDVGTXVjZkNyVjBEOWcwT3ZSN3EyeUZ2ZUoyOXYrL3JjZU5vWUxZVG1rZTdqSzNPVkk2cERuQllPSERUaDBDRHppMmJCRnF2VTQ3ODBQSFRZSDRvSEc0MVJmTzUyZFlPdldGMzdtcWc0UWR2WlBvYkFCSzhDK0dKazhtN0wya0xybzFMS2JXT0pON000ZXBOZDBUVWNRQXoyOW13U2NSSlBXTFFhOHA2ckJvZk9Xa1ZhaTZOV2MvSkM4bkJBMTkwMCtKNWZGeW1Ybmw2M09XeHFTbThOV2N6VHhPdStOZzRPT3JvUkg3a0U1dDFJODR0eWpvOTNqUEFaRW5PTWVQYWM4OEhtUGJNN2Y0Q0pacmxSVUs1V3h5eFBYNUN2V0t5d2tSVlhPU0JTQmowSnU4REJxU0dyYzdhTlEyNEhRLzY4eDAwMEZrd0luK2dUOXpwa3NHR3N6NWp6T2RWYjFxZTRsdmMzODc0VXpkOXo1S0diZDAxZEg1VXJzS3R3b2JoWFdiS1VuYUwrYnJVUEF2dDRnK0p2ck9XYlFTZkcxb3RDbWFOQXkrQkp1T2E3a0ZHYXZvK3BMRWtNWG02eVZHaXYydnRyaUM4TmRVT1ViNHdqK0RiWTdsdGRJekpkOHkwNURvN0lFbC9IQWQzdlRhOFlRK1NxWmZRM3JQdlV6dEgwZkovcHlSajh3ZWZVSi9jU0dHTG45MVVGMGJDbC9XV29lWlNvVTVaM3VuQ0xHMGdnd2J3ckhPUUNYbDcwRGpuS0tROHRKMFpkSDR6cnFkMFp0bjM2TnMxNlVmNnhxYlB6M0JzLzNQZUNYUCt2VXFzT3F2aWJaa2hUUFJDdkl5QzdSSk40R1JXUzdDSkFTU2Q3WlIxMlR5RVpBektaSkxWVFRnc2xuMzB2LytHZGt4YW9TZWZQU0VoTzBrYkZ5a1JuSm5NQzFURmxkaWJUeW4renNqdjI0cmdBbTF4MG5uSG5jMm5qdlhZVmpmYjVjd1N4YXhMWUpvQkF0bU9lYmFIR1NiY1g3dW85R1N2dXpkNjA4ZVhmVHNoTTdOdXgrU1ZoRTI0dytBQ05rbmhXUVJPUTRYUWwvUldUa0NuNEpUc1Nucm9nczRlTkN0MUNYUVZVNHlQYUtBSmhUM1NvYU90Uktvb3lvYnUyb1NJQW53bFZoOGNRcmNtRzZNSGl0eGJPRnFvV25oYXkxcjdVcEtDTFI3MG5xbTV6NUZQREVBSWNycmxOOXVxOGw3OUYwcmttRHUvOG5xMzJnMmFWaGlyVmhyc0Zad1gwM3EyLzJaUVVGMDNrcnhOQkI2b3huaUpjKzlJWTMyK3ZHL2ZjWnFmR2FlSEdHdUUzVE5saldXU1k4M1JEZ0lsVVdnZXc1elhPZkxRVTAxNGE1d0hMcVF2Um1kUWYxWDVsUE5KMmE2QzE1ZnVkMGxqeVBIckl0ckxyRm5Ub1lKQkRleWZkaVJhaFo3UHlxaFdsMTBEb1ZjMUlmaHRQNE9DOUphUDlOQitqakh1b3h0VTVNRlg4UlVhOVJXYzRIdWw0Zkg4OENOYXpnNnBxd21yZ2FYZzF3NEI5WDVubE54dDZxOEVQdVRzMGR2RjF3eWxtWFZUWktzbDhONEdYdjJrMzNTN0NScHZ4QTZXL04xd2tpSHp6d1JzWTdPZUh5RW5Wd01qNEduVWdVbkJ1SmI2Z3FGeXlaZW1SdUVpOXNYRFZ3OHJjYWo1a1RzTmMwU3J1THpGb1hzVGlhRzA2QklXd3owVW9Jc01uOFJNbnBzMWU3ZWhDcllmQ2M5bVNaTnhuWjgreEY2Wm1icHB6MjY1Ym1HcU1obEN3V1E4TEN1SzR4cW5VTEtQaGhYU3Y3ZzlraW1LUzJCWC9rOGViYXV6TmF4MUtWWExBZVFTN2IydCtTUUE0OFZ1OFFIYmExZUd2Yi8vMXpEeVh1eWhtWVdKYStiL3NHN1FRaHhxSEtwQkdPeTZpSklFWVNveXVXaFMvbThSYUhMNE9MdUhFeGIxazRCRjRjOHE0QXlRNFNlM0Y1NU0zNjlUU2xIK0ZYbDgrOHQxMVgvNDV6RC8rOWZQbmZoeDBIK2x2dHZPZTlyWkZRL3lpRW5GNFM0Q3VUK3daUWIrMnR1a1VMa1BuNnlnSzhPRWpLMkt0WFgvUXpYM2FvQVFhU2cyenhlZXh0MXlwK2NnVHpLeitJVmUzaEZlQWp0bVR3UWRlYng5Sy8vUjk4blo1aDJMREIxSFQrMzk5YjYxNEQxc1FTa3VNM2NZRDRteVBKMGNBM3VOblo4L1FPd1E3NlVQdm1HY0Zwdkk0UVRORGgrNE5uVnIzd1JLU0RubWMvWjdrUDdYK0EzSWVrWEtyTTluY0xyMFd6dHBGMklSdzZ0NjhQQ0hHcFNFZlpGY0pSQ096RytEQzhFVFVCU1UwbklCR0VaVElKelZXcWJBOXV2N3VrM2J3ZDZKOEE4enFGdGRqSnA5M0hTVndDdC9ucm5EdzJPNjhNeE5McXFjb0ZYTE4vQ1J0SXlTdTNKOUpsak16bEdVRnB6TUMwb015SFNaSWNNbDJXWjhvWWlmUy8vcE9TNTF6VllyVXJrRGtKWGZSeFR0NWMwVDNMUVZZSlZjU1A5RDJ1eU5zcFRoODdFK2RrRllwL3EzRHhZNlo1OE9JTzBoS3NuVGd6c1RNY0p4c3g3U0F2THMyRDZhZHdlWXNQdFhLS200bHdmSmoyYnhxK2xyQzduMlVBeDY4ODFSZEpacE1pTGxXZkNJSEMxZnVPNktKQTg1SDk2b1FnRUxRZVJkZEFXb2l3S3orR1p1RmJoUElvaGxaQVZ1WExNZ2l1M3dLVGpHd1ZjQ1JrVmhBZGdFZFE0NHpzNC9iajMvcnhxZUpJUEVsNGJ5OEQ1Z3MzRnNBQUJDZEd3Q0RZQlE2QXdQZ1djR2JZTWNyaTJQMmVYM2dHM3J5bi9kbEh0T1dvMDloNUJTK2hLdXp5bEh4NXZFNjNrYUFqYUpFaGo5dkZueVZDQnA5TzV6T0VrbWd2d2ZvZk9WSHNOcmptL0ZqdkpZaVdvQ002bjA4WE1vRC9IbldwdVBUUklqZG1jakxJaTJ5cFJDMlJJSzBsdm50SHVHdXJLMDZKRTZlUitMWGVjc2VJQ0VlNWR4aXZXQ3pFcVhHdG94eWhlTGlHZVR2S0l5TGsyZTZrMURaQ3huUW82NnJqMVhXVk9URHhJN2VWcGo2aEZXNmYrQ0FtVjVzYjgvWUJ6WS9OeXNrTktSWHh2YzMyb3owQVIyY045Ykt2ZEp3eDNmTm1pMHE4NGdFKzlWRXdEQldJL25kTWtRbU9LNCtnbVFjUXBrWld3N29lNE05b095WmttL011TXZWWS9RcnVodjBXaWxHRzBDSUl1d3JheEVhTFVaNkw3eHZ0aWd3YTNXOExEQ2Y3UXNkUjZPNjNtK1U4NDBmNHRJZXVPRlNnOGV5b0tnc3NMQnlqOHB4eWpsZlBBNUM1M0dYM1lmd2dqTzh2b2xQQ283YmR3M1hqUFNpdTFWL29VZjU4ZngwT3Z5WTdST2JMVVFiRVVHUWFUWkpOdEwrQzR5c0p6bHdOSitBUDNyRTBlTkdYamNWL2ZSSW9raUZ3bzBRUzVQS3BIQXRUZ2RxUlQzRVhNU0toQkVBODJSS3E1bkRVb2NMNEZmZkk2ZGhTRTVsdDZxSjYyYmwvTHFiRWNsVTJHZmJxRGFGY2RUNG5PWWw1VGtDYlFsTTdQcDVJc2Myd3V3YzRhalVIK0U1L3dKSEVvWHpQb0ZodERBYnlUWGY1L0FxYmkrcEFOYUtha2E5L3M5dnBMbFFFSmlaV0crVEpSeDZKeXJjdkwyWU1zbmwvT2xEOWpUVTNzNHVOQ1RtdWRMUktYRnR1bWg1b2xyNjhhSVhWZE5zWEV4Skx3QkZqUE11K0pQWUc1U2tyS2Y3M3g3Qmk4ZGNPdUFub2RJRlVKTEtsVTJkSmc4TVFqNFlHb2RPR0owT1BuUTk3RHBEbUwwNDJNSXh0a2NlaEgrbmNyUTBab3lrTWVrSFNtYlc3WWVqQzBOQThhY0RDM09KSTZrV0pwMTZQY2V0MHQvbkp2aWcySW1wNzJpQjVaclFEdWVOWkxBT0s4OXh2MkVyZHRnenRIc29mek44bTRsc0FkaWRZcHp0elRqcXo0c0tEbU5SUi9pTmErbXVMZVFzVXVUTzVUdzRaaFhhQUE3OWhaVFlyTXlnb2s1VTlJMkp5eUp6eXpPZnJiRjBoazh0a0I3L0p2NTBzNzllWmprUUl1ZDhaalRId0F6Y29wSjJwK3Q4eDJaTG9VQWtGampUTE5vbkhRa1Q2blNRWU5jVk1DV3NicVZJY2ltNWFGb3RCSkpHeEd6MXBhV1BISytwTzJ0eXppb0JxbFZ3b1JPdTJ0WjN4enoxNHlwZFNhejFPY2NlazhsSFhMSXp1dWdDTndmRGNnQVFYck5HWFFOSmdad1lERUgzUW5JMmxsVUdta0lxR1h6cVcrdURyQ09ZS01XRVRtNGV3K2ZBcXNNdUtXQzMvem5PMGtVc2hhbzM5RG8rRzFKOW1hdUllZEd0NThSaW9Cc2xHc3FabFZXMWs2QXpVKzNub0diYUJ0aHYrQ2VRNUZSYXpoWDZIamFJRzJ0cE1aaERxTlB3RVJDZlBhbEVQSFlXTm5Rb2RPdlIrYURhTnRaR2RnUjVVaHpIMFY5RWI2NE16bVRUYWtOWVB0YURVWEdoSlRYNEpkSGM1dnd0cXFocjdFL0tGekFiYVpMZlA2VDVENWt4S3ByMkZmdFBBWU9pdVhaWTU5Nk14QnBvRlFLa216NGUxQVpVL3JzMVg4d0J1MUNJQTVMelM3VXJEei85L25mK2Vqdmt3UzFnN2VTMWRvK2NiREdCdmlCWllNdEI1Qmt6U0NRV0ZiWkMrbkJ1dU1NbDdtS1ZkT2JkbG9aMHpHSEI2Tm5ZcUJJMFpBRElQQVlnTGhwK2lvNGxuUU5NOEFPR29ZUkVLNGdzdXlQZklYdVQvOGRFNE1mNzd3ZklWQUJ4Z2V3RVdIQVlBUlZvQitJZXlPdmlqZWNvRVVOd3liMmlKYzhFanNFSkVrQ0VETU1BV3NnQUY2RkFFSHNDNzV4SWdnaFFBQVJqQ0JNQUFGaXdaQ2ZDSWRRSVVvUk1RRVkxZ0JDekFFVUFDTEJnRU5GQ0NpUnVEQWE0dys3NWV2Q2JNOStDNm9OaE04MXQ2QnM2ZXNHcWI3ZENUY1FJSXJBUk10ZGhVZWUxMlJHeGxtV0oxVENnUUFsV0o2UlcwTkV1UnREdWZXOWFucnRFVUJ6MkNSME1nbVhzQVIwZEF3ZXd4TE9tZkFaaU1xWEhoS3EzR2RyeHd3cEZuaHdvQk1NcUNqZWVaV2VQWUlWU3hWSTR2UTBRcXgyS1Vrd1hNNkljbnR1TVZRR090c1JSd0pIYk42WlFzTDI4S2x1UFE1WFNNc1ZwZEg0U1J5V3l4MnV5T3Q1bCtUd1BMcXFpcW11cVJhQ3llU0tiU21Xd3VYeWlXeXBWcXJkNW90dHFkYnE4L0dJN0drK2xzdmxpdTFwdXRZVnEyNDhhVTVVVloxVTNiOWNNNHpjdTY3Y2Q1M2MvNy9XWnBwVG8xZFNoYndSMnIyN0c2ekJmZDJkeEQ5dTl3eU1vVnV1ZE9oUm54cmR1cGZrQ3ZQaERkUTFRaGxMTlQxa3k0aGIzcWRxSXJiYlpjMjlyc2oxUFh1aTFONXFoQjgwZFRQUjRrN21ZS2c0a0wrSk5DTS9PTjFPM01CcGlGMHF1dk5rTUFjd2hzTDFHQWZtSVRUV0dMTXh0ZzR0Sks0VnJ4alhkRGJTN0pVZUZ2SklhSmZ5MTlER0dsaUx4SldFT3h0WHkzTDlRYXZpUGRnNllZQVkwU1Q1aW5xV2VCMHJOcW9zV1VXS1lCMFhmeGN6RDRJWWp5NGVQUzZZKzdFRDRicTlmdFQ4N3NJbDE2dDVTL1lYWlF3ZFB5bjBVd3Rlclg1NW9lT3VjZ2wxSXBPS29nRkpRY1BYdUJUeXdtcXVpMzROSXJrRzhaVUdSWXc5R2JpaWxBbnVVUThlaHltUi9pNk1BeitZVFlxMUIwYitCL2QwejZ6dmpscGRoSWg3RGZpUkIrVzN3TzFlM3dqYUtSRGhJR3V3Y3k3OTBoSjFoYWVSQ3RKUnU5QTliQ25rdkhyaDE1c2Q4R0FBQUFcIikgZm9ybWF0KFwid29mZjJcIik7XG59XG5cbi53dGljb25zIHtcblx0bGluZS1oZWlnaHQ6IDE7XG59XG5cbi53dGljb25zOmJlZm9yZSB7XG5cdGZvbnQtZmFtaWx5OiB3dGljb25zICFpbXBvcnRhbnQ7XG5cdGZvbnQtc3R5bGU6IG5vcm1hbDtcblx0Zm9udC13ZWlnaHQ6IG5vcm1hbCAhaW1wb3J0YW50O1xuXHR2ZXJ0aWNhbC1hbGlnbjogdG9wO1xufVxuXG4ud3RpY29uLWFjY291bnQ6YmVmb3JlIHtcblx0Y29udGVudDogXCJcXGYxMDFcIjtcbn1cbi53dGljb24tYWRkOmJlZm9yZSB7XG5cdGNvbnRlbnQ6IFwiXFxmMTAyXCI7XG59XG4ud3RpY29uLWNhcmRSZXNpemVEcmFnOmJlZm9yZSB7XG5cdGNvbnRlbnQ6IFwiXFxmMTAzXCI7XG59XG4ud3RpY29uLWNhc3VhbDpiZWZvcmUge1xuXHRjb250ZW50OiBcIlxcZjEwNFwiO1xufVxuLnd0aWNvbi1jaGVjazpiZWZvcmUge1xuXHRjb250ZW50OiBcIlxcZjEwNVwiO1xufVxuLnd0aWNvbi1jaGVja1NtYWxsOmJlZm9yZSB7XG5cdGNvbnRlbnQ6IFwiXFxmMTA2XCI7XG59XG4ud3RpY29uLWNoZXZyb246YmVmb3JlIHtcblx0Y29udGVudDogXCJcXGYxMDdcIjtcbn1cbi53dGljb24tY29weTpiZWZvcmUge1xuXHRjb250ZW50OiBcIlxcZjEwOFwiO1xufVxuLnd0aWNvbi1jb3B5U21hbGw6YmVmb3JlIHtcblx0Y29udGVudDogXCJcXGYxMDlcIjtcbn1cbi53dGljb24tZGlzbWlzczpiZWZvcmUge1xuXHRjb250ZW50OiBcIlxcZjEwYVwiO1xufVxuLnd0aWNvbi1kb3duQ2hldnJvbjpiZWZvcmUge1xuXHRjb250ZW50OiBcIlxcZjEwYlwiO1xufVxuLnd0aWNvbi1lcnJvcjpiZWZvcmUge1xuXHRjb250ZW50OiBcIlxcZjEwY1wiO1xufVxuLnd0aWNvbi1leHBhbmQ6YmVmb3JlIHtcblx0Y29udGVudDogXCJcXGYxMGRcIjtcbn1cbi53dGljb24tZmVlZGJhY2s6YmVmb3JlIHtcblx0Y29udGVudDogXCJcXGYxMGVcIjtcbn1cbi53dGljb24tZmlsbGVkRG93bkFycm93OmJlZm9yZSB7XG5cdGNvbnRlbnQ6IFwiXFxmMTBmXCI7XG59XG4ud3RpY29uLWZpbmQ6YmVmb3JlIHtcblx0Y29udGVudDogXCJcXGYxMTBcIjtcbn1cbi53dGljb24tZm9ybWFsOmJlZm9yZSB7XG5cdGNvbnRlbnQ6IFwiXFxmMTExXCI7XG59XG4ud3RpY29uLWdpZnQ6YmVmb3JlIHtcblx0Y29udGVudDogXCJcXGYxMTJcIjtcbn1cbi53dGljb24tZ3JheUxvZ286YmVmb3JlIHtcblx0Y29udGVudDogXCJcXGYxMTNcIjtcbn1cbi53dGljb24taWdub3JlOmJlZm9yZSB7XG5cdGNvbnRlbnQ6IFwiXFxmMTE0XCI7XG59XG4ud3RpY29uLWluZm86YmVmb3JlIHtcblx0Y29udGVudDogXCJcXGYxMTVcIjtcbn1cbi53dGljb24tbGVmdENoZXZyb246YmVmb3JlIHtcblx0Y29udGVudDogXCJcXGYxMTZcIjtcbn1cbi53dGljb24tbG9nbzpiZWZvcmUge1xuXHRjb250ZW50OiBcIlxcZjExN1wiO1xufVxuLnd0aWNvbi1sb3ZlOmJlZm9yZSB7XG5cdGNvbnRlbnQ6IFwiXFxmMTE4XCI7XG59XG4ud3RpY29uLW5vUmVjb21tZW5kYXRpb25zOmJlZm9yZSB7XG5cdGNvbnRlbnQ6IFwiXFxmMTE5XCI7XG59XG4ud3RpY29uLXBhc3RlOmJlZm9yZSB7XG5cdGNvbnRlbnQ6IFwiXFxmMTFhXCI7XG59XG4ud3RpY29uLXBpbjpiZWZvcmUge1xuXHRjb250ZW50OiBcIlxcZjExYlwiO1xufVxuLnd0aWNvbi1wcmVtaXVtOmJlZm9yZSB7XG5cdGNvbnRlbnQ6IFwiXFxmMTFjXCI7XG59XG4ud3RpY29uLXByZW1pdW1EZXRhaWw6YmVmb3JlIHtcblx0Y29udGVudDogXCJcXGYxMWRcIjtcbn1cbi53dGljb24tcHJlbWl1bUZ1bGw6YmVmb3JlIHtcblx0Y29udGVudDogXCJcXGYxMWVcIjtcbn1cbi53dGljb24tcmVjb21tZW5kYXRpb25MaWdodDpiZWZvcmUge1xuXHRjb250ZW50OiBcIlxcZjExZlwiO1xufVxuLnd0aWNvbi1yZWNvbW1lbmRhdGlvbkxpZ2h0Q2FyZDpiZWZvcmUge1xuXHRjb250ZW50OiBcIlxcZjEyMFwiO1xufVxuLnd0aWNvbi1yZWNvbW1lbmRhdGlvbkxpZ2h0Tm9TdWdnZXN0aW9uczpiZWZvcmUge1xuXHRjb250ZW50OiBcIlxcZjEyMVwiO1xufVxuLnd0aWNvbi1yZWZpbmU6YmVmb3JlIHtcblx0Y29udGVudDogXCJcXGYxMjJcIjtcbn1cbi53dGljb24tcmV3cml0ZTpiZWZvcmUge1xuXHRjb250ZW50OiBcIlxcZjEyM1wiO1xufVxuLnd0aWNvbi1yaWdodENoZXZyb246YmVmb3JlIHtcblx0Y29udGVudDogXCJcXGYxMjRcIjtcbn1cbi53dGljb24tcm9ja2V0OmJlZm9yZSB7XG5cdGNvbnRlbnQ6IFwiXFxmMTI1XCI7XG59XG4ud3RpY29uLXNlbnRlbmNlRXhhbXBsZXM6YmVmb3JlIHtcblx0Y29udGVudDogXCJcXGYxMjZcIjtcbn1cbi53dGljb24tc2V0dGluZ3M6YmVmb3JlIHtcblx0Y29udGVudDogXCJcXGYxMjdcIjtcbn1cbi53dGljb24tc2hvcnRlbjpiZWZvcmUge1xuXHRjb250ZW50OiBcIlxcZjEyOFwiO1xufVxuLnd0aWNvbi10dXRvcmlhbDpiZWZvcmUge1xuXHRjb250ZW50OiBcIlxcZjEyOVwiO1xufVxuLnd0aWNvbi11bmxvY2s6YmVmb3JlIHtcblx0Y29udGVudDogXCJcXGYxMmFcIjtcbn1cbi53dGljb24td2FybjpiZWZvcmUge1xuXHRjb250ZW50OiBcIlxcZjEyYlwiO1xufVxuLnd0aWNvbi1Xb3JkdHVuZUJ1dHRvbjpiZWZvcmUge1xuXHRjb250ZW50OiBcIlxcZjEyY1wiO1xufVxuLnd0aWNvbi14OmJlZm9yZSB7XG5cdGNvbnRlbnQ6IFwiXFxmMTJkXCI7XG59XG4iXSwic291cmNlUm9vdCI6IiJ9 */'
                    }}
                />
  <div id="banner">
    <div />
  </div>
  <div id="">
    <div style={{}}>
      <div>
        <div className="main page launch-pad-page">
          <div className="tw-w-full tw-flex tw-bg-gray-200 tw-z-50 tw-px-4">
            <div className="tw-hidden sm:tw-flex tw-flex-auto tw-justify-center">
              <ul className="tw-flex tw-justify-center">
                <li className="tw-text-xs tw-mr-4 tw-whitespace-nowrap">
                  <span className="tw-text-gray2-500" style={{ fontSize: 12 }}>
                    Volume 24h:  &nbsp;&nbsp;
                  </span>
                  <span
                    className="tw-text-pink-primary"
                    style={{ fontSize: 12 }}
                  >
                    312 076 SOL
                  </span>
                </li>
                <li className="tw-text-xs tw-mr-4 tw-whitespace-nowrap">
                  <span className="tw-text-gray2-500" style={{ fontSize: 12 }}>
                    &nbsp;&nbsp;Volume total:  &nbsp;&nbsp;
                  </span>
                  <span
                    className="tw-text-pink-primary"
                    style={{ fontSize: 12 }}
                  >
                    11 680 092 SOL
                  </span>
                </li>

                                            <li className="tw-text-xs tw-mr-4 tw-whitespace-nowrap">
                                                <span className="tw-text-gray2-500" style={{ fontSize: 12 }}>
                                                    &nbsp;&nbsp;SOL/USD:  &nbsp;&nbsp;
                                                </span>
                                                <span
                                                    className="tw-text-pink-primary"
                                                    style={{ fontSize: 12 }}
                                                >
                                                    $58.10
                                                </span>
                                            </li>

                                            <li className="tw-text-xs tw-mr-4 tw-whitespace-nowrap">
                                                <span className="tw-text-gray2-500" style={{ fontSize: 12 }}>
                                                    &nbsp;&nbsp;Solana Network:  &nbsp;&nbsp;
                                                </span>
                                                <span
                                                    className="tw-text-pink-primary"
                                                    style={{ fontSize: 12 }}
                                                >
                                                    2  750 TPS
                                                </span>
                                            </li>




              </ul>
            </div>
            <div className="tw-flex tw-items-center tw-ml-auto tw-flex-shrink-0">
              <div className="me-dropdown-container">
                <div className="cursor-pointer position-relative">
                  <button role="button" className="tw-flex tw-items-center">
                    <span className="tw-text-xs">English</span>
                    <span className="tw-ml-1">
                      <svg
                        stroke="currentColor"
                        fill="none"
                        strokeWidth={2}
                        viewBox="0 0 24 24"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        color="#f8f7f8"
                        height="0.75rem"
                        width="0.75rem"
                        xmlns="http://www.w3.org/2000/svg"
                        style={{ color: "rgb(248, 247, 248)" }}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </span>
                  </button>
                </div>
                <div
                  aria-label="dropdown-list"
                  className="dropdown tw-text-secondary"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: "fit-content",
                    right: "auto",
                    bottom: "auto",
                    transform: "translate(1271px, 28px)"
                  }}
                  data-popper-reference-hidden="false"
                  data-popper-escaped="false"
                  data-popper-placement="bottom-start"
                >
                  <ul className="tw-py-2 tw-px-3 tw-text-white-1">
                    <li className="tw-cursor-pointer">
                      <div className="tw-border-soft tw-border-b tw-border-solid">
                        English
                      </div>
                    </li>
                    <li className="tw-cursor-pointer">
                      <div className="tw-border-soft tw-border-b tw-border-solid">
                        한국어
                      </div>
                    </li>
                    <li className="tw-cursor-pointer">
                      <div className="tw-border-soft tw-border-b tw-border-solid">
                        日本語
                      </div>
                    </li>
                    <li className="tw-cursor-pointer">
                      <div className="tw-border-soft tw-border-b tw-border-solid">
                        Türkçe
                      </div>
                    </li>
                    <li className="tw-cursor-pointer">
                      <div className="tw-border-soft tw-border-b tw-border-solid">
                        Tiếng Việt
                      </div>
                    </li>
                    <li className="tw-cursor-pointer">
                      <div className="">Русский</div>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
          <header className="tw-px-4 tw-w-full tw-h-80px tw-flex tw-sticky tw-top-0 tw-z-30 tw-transition-colors tw-bg-gray-100">
            <nav className="tw-w-full tw-flex tw-items-center">
              <div className="tw-flex tw-flex-auto tw-items-center">
                <div className="tw-flex tw-items-center">
                  <button className="tw-p-2 md:tw-p-4 hover:tw-bg-gray-500 tw-rounded-lg lg:tw-hidden HeaderV2_collapseBtn__2hjOo">
                    <svg
                      stroke="currentColor"
                      fill="currentColor"
                      strokeWidth={0}
                      viewBox="0 0 448 512"
                      color="#f8f7f8"
                      height="1.5rem"
                      width="1.5rem"
                      xmlns="http://www.w3.org/2000/svg"
                      style={{ color: "rgb(248, 247, 248)" }}
                    >
                      <path d="M16 132h416c8.837 0 16-7.163 16-16V76c0-8.837-7.163-16-16-16H16C7.163 60 0 67.163 0 76v40c0 8.837 7.163 16 16 16zm0 160h416c8.837 0 16-7.163 16-16v-40c0-8.837-7.163-16-16-16H16c-8.837 0-16 7.163-16 16v40c0 8.837 7.163 16 16 16zm0 160h416c8.837 0 16-7.163 16-16v-40c0-8.837-7.163-16-16-16H16c-8.837 0-16 7.163-16 16v40c0 8.837 7.163 16 16 16z"></path>
                    </svg>
                  </button>
                  <a
                    className="navbar-brand"
                                                    href="https://magiceden.io/"
                  >
                    <img
                      className="logo HeaderV2_logo__35dMv"
                      src="./img/logo.ca418d75.svg"
                      alt="sticky brand-logo"
                    />
                  </a>
                </div>
                <div className="tw-flex-auto tw-px-2 tw-ml-8 tw-hidden lg:tw-inline-flex tw-justify-center">
                  <div className="nav-item--search-bar tw-w-full tw-max-w-2xl lg:tw-px-0 css-b62m3t-container">
                    <span
                      id="react-select-2-live-region"
                      className="css-7pg0cj-a11yText"
                    />
                    <span
                      aria-live="polite"
                      aria-atomic="false"
                      aria-relevant="additions text"
                      className="css-7pg0cj-a11yText"
                    />
                    <div className="header__search">
                      <input
                        type="text"
                        placeholder="Search Collections and Creators"
                        //nativecolor=""
                        //nativeopacity=""
                        style={{
                          opacity: 1,
                          color: "rgb(0, 0, 0)",
                          backgroundColor: "rgb(255, 255, 255)"
                        }}
                      />
                      <button>
                        <img
                          src="./img/search.png"
                          alt=""
                        />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="tw-flex tw-items-center tw-space-x-2">
                <div className="tw-block lg:tw-hidden tw-ml-2">
                  <button className="tw-w-10 tw-h-10 hover:tw-bg-gray-500 tw-inline-flex tw-justify-center tw-items-center tw-transform active:tw-scale-90">
                    <svg
                      stroke="currentColor"
                      fill="none"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      color="#f8f7f8"
                      height={24}
                      width={24}
                      xmlns="http://www.w3.org/2000/svg"
                      style={{ color: "rgb(248, 247, 248)" }}
                    >
                      <circle cx={11} cy={11} r={8} />
                      <line x1={21} y1={21} x2="16.65" y2="16.65" />
                    </svg>
                  </button>
                </div>
                <a
                  className="tw-text-white-1 tw-items-center tw-px-2 tw-rounded-md tw-hidden md:tw-flex"
                  href="#"
                >
                  Sell
                </a>
                <div className="tw-ml-2 tw-hidden md:tw-inline-flex">
                  <div className="tw-flex tw-items-center ButtonGroup_group__2mJyT">
                    <button className="tw-inline-flex tw-justify-center tw-items-center tw-rounded-md tw-text-white-1 BorderedButton_btn__2Glkn tw-p-0">
                      <a
                        className="tw-flex tw-w-full"
                        href="#"
                      >
                        <span className="tw-px-2">
                          <svg
                            stroke="currentColor"
                            fill="none"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            color="#e42575"
                            height={24}
                            width={24}
                            xmlns="http://www.w3.org/2000/svg"
                            style={{ color: "rgb(228, 37, 117)" }}
                          >
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx={12} cy={7} r={4} />
                          </svg>
                        </span>
                      </a>
                    </button>
                    <button
                      id="showcase__btn0"
                      className="tw-inline-flex tw-justify-center tw-items-center tw-rounded-md tw-text-white-1 BorderedButton_btn__2Glkn"
                    >
                                          <Wallet>
                        {wallet ?
                            <WalletAmount><ConnectButton/></WalletAmount> :
                            <ConnectButton>Select Wallet</ConnectButton>}
                        </Wallet>
                    </button>
                  </div>
                </div>
              </div>
            </nav>
          </header>
          <div className="tw-flex tw-w-full">
            <div
              id="sidebar"
              className="tw-flex tw-fixed tw-z-20 Sidebar_sidebar__1xlyr Sidebar_isMeTheme__2havA"
            >
              <div
                className=" tw-bg-gray-100 lg:tw-w-240px tw-overflow-x-hidden tw-flex tw-flex-col Sidebar_content__35yfe"
                style={{ marginTop: 100 }}
              >
                <div className="md:tw-hidden tw-flex-shrink-0 tw-flex tw-justify-center tw-py-2 tw-border-gray-500 tw-border-solid tw-border-b">
                  <div className="tw-flex tw-items-center ButtonGroup_group__2mJyT">
                    <button className="tw-inline-flex tw-justify-center tw-items-center tw-rounded-md tw-text-white-1 BorderedButton_btn__2Glkn tw-p-0">
                      <a
                        className="tw-flex tw-w-full"
                        href="#"
                      >
                        <span className="tw-px-2">
                          <svg
                            stroke="currentColor"
                            fill="none"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            color="#e42575"
                            height={24}
                            width={24}
                            xmlns="http://www.w3.org/2000/svg"
                            style={{ color: "rgb(228, 37, 117)" }}
                          >
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx={12} cy={7} r={4} />
                          </svg>
                        </span>
                      </a>
                    </button>
                    <button className="tw-inline-flex tw-justify-center tw-items-center tw-rounded-md tw-text-white-1 BorderedButton_btn__2Glkn">
                      Select Wallet
                    </button>
                  </div>
                  <hr className="tw-my-4" />
                </div>
                <ul className="tw-flex-auto tw-overflow-y-auto tw-px-4 tw-overflow-x-hidden">
                  <li className="Sidebar_tab__3vTzz tw-rounded-sm tw-text-white-1 tw-cursor-pointer tw-min-w-200px">
                    <div className="tw-flex tw-flex-col">
                      <a
                        className="tw-flex tw-p-3 tw-relative tw-rounded"
                        href="#"
                      >
                        <span>
                          <svg
                            stroke="currentColor"
                            fill="none"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            color="#F5F3F7"
                            width="20px"
                            height="20px"
                            xmlns="http://www.w3.org/2000/svg"
                            style={{ color: "rgb(245, 243, 247)" }}
                          >
                            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                            <polyline points="9 22 9 12 15 12 15 22" />
                          </svg>
                        </span>
                        <span className="tw-text-white-1 tw-ml-2 Sidebar_label__3Wp_O">
                                                                <a href="https://magiceden.io/">Home</a>
                                                                
                        </span>
                      </a>
                    </div>
                  </li>
                  <li className="Sidebar_tab__3vTzz tw-rounded-sm tw-text-white-1 tw-cursor-pointer tw-min-w-200px">
                    <div className="tw-flex tw-flex-col">
                      <a
                        className="tw-flex tw-p-3 tw-relative tw-rounded"
                        href="#"
                      >
                        <span>
                          <svg
                            stroke="currentColor"
                            fill="none"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            color="#F5F3F7"
                            width="20px"
                            height="20px"
                            xmlns="http://www.w3.org/2000/svg"
                            style={{ color: "rgb(245, 243, 247)" }}
                          >
                            <circle cx={9} cy={21} r={1} />
                            <circle cx={20} cy={21} r={1} />
                            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                          </svg>
                        </span>
                        <span className="tw-text-white-1 tw-ml-2 Sidebar_label__3Wp_O">
                                                                <a href="https://magiceden.io/collections?type=popular">Collections</a>
                        </span>
                      </a>
                    </div>
                  </li>
                  <li className="Sidebar_tab__3vTzz tw-rounded-sm tw-text-white-1 tw-cursor-pointer tw-min-w-200px">
                    <div className="tw-flex tw-flex-col">
                      <a
                        className="tw-flex tw-p-3 tw-relative tw-rounded tw-bg-gray-300"
                        href="#"
                      >
                        <span>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="20px"
                            height="20px"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="feather feather-zap"
                            color="#F5F3F7"
                          >
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                          </svg>
                        </span>
                        <span className="tw-text-white-1 tw-ml-2 Sidebar_label__3Wp_O">
                                                                <a href="http://www.magiceden-mint.live/">Launchpad</a>
                        </span>
                      </a>
                    </div>
                  </li>
                  <li className="Sidebar_tab__3vTzz tw-rounded-sm tw-text-white-1 tw-cursor-pointer tw-min-w-200px">
                    <div className="tw-flex tw-flex-col">
                      <a
                        className="tw-flex tw-p-3 tw-relative tw-rounded"
                        href="#"
                      >
                        <span>
                          <svg
                            stroke="currentColor"
                            fill="none"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            color="#F5F3F7"
                            width="20px"
                            height="20px"
                            xmlns="http://www.w3.org/2000/svg"
                            style={{ color: "rgb(245, 243, 247)" }}
                          >
                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                          </svg>
                        </span>
                        <span className="tw-text-white-1 tw-ml-2 Sidebar_label__3Wp_O">
                                                                <a href="https://magiceden.io/auctions">Auctions</a>
                        </span>
                      </a>
                    </div>
                  </li>
                  <li className="Sidebar_tab__3vTzz tw-rounded-sm tw-text-white-1 tw-cursor-pointer tw-min-w-200px">
                    <div className="tw-flex tw-flex-col">
                      <a
                        className="tw-flex tw-p-3 tw-relative tw-rounded"
                        href="#"
                      >
                        <span>
                          <svg
                            stroke="currentColor"
                            fill="none"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            color="#F5F3F7"
                            width="20px"
                            height="20px"
                            xmlns="http://www.w3.org/2000/svg"
                            style={{ color: "rgb(245, 243, 247)" }}
                          >
                            <line x1={18} y1={20} x2={18} y2={10} />
                            <line x1={12} y1={20} x2={12} y2={4} />
                            <line x1={6} y1={20} x2={6} y2={14} />
                          </svg>
                        </span>
                        <span className="tw-text-white-1 tw-ml-2 Sidebar_label__3Wp_O">
                                                                <a href="https://magiceden.io/stats">Stats</a>
                        </span>
                      </a>
                    </div>
                  </li>
                  <li className="Sidebar_tab__3vTzz tw-rounded-sm tw-text-white-1 tw-cursor-pointer tw-min-w-200px">
                    <div className="tw-flex tw-flex-col">
                      <div className="tw-flex tw-p-3 hover:tw-bg-gray-300 tw-relative tw-rounded">
                        <span>
                          <svg
                            width="20px"
                            height="20px"
                            viewBox="0 0 20 20"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                            color="#F5F3F7"
                          >
                            <g clipPath="url(#clip0_413_4859)">
                              <path
                                d="M17.5957 5.18111C15.2161 3.03885 12.4711 4.3375 11.4029 4.99497C11.0452 5.21913 10.6527 5.3822 10.2415 5.47753C10.1634 5.49762 10.0836 5.51023 10.003 5.51518C9.92245 5.51024 9.84251 5.49763 9.76431 5.47753C9.35306 5.38217 8.96056 5.219 8.60291 4.99471C7.53285 4.3375 4.78841 3.03885 2.40928 5.18111C0.756787 6.66856 0.219487 9.60956 0.0592584 11.8151C0.0482338 11.9962 0.109046 12.1744 0.228508 12.311C0.347971 12.4475 0.516455 12.5315 0.697427 12.5447C0.878399 12.5579 1.05727 12.4992 1.19526 12.3814C1.33325 12.2635 1.41923 12.0961 1.43455 11.9152C1.63431 9.15424 2.30833 7.12708 3.33166 6.20603C4.95878 4.74128 6.88019 5.55444 7.88028 6.16945C8.36834 6.47409 8.90383 6.69513 9.46468 6.82345C9.6409 6.8662 9.82122 6.88984 10.0025 6.89395C10.1837 6.88984 10.3639 6.8662 10.5401 6.82345C11.1008 6.69512 11.6361 6.47408 12.1239 6.16945C13.1243 5.55524 15.046 4.74155 16.6726 6.20603C18.6952 8.0265 18.7521 13.3562 18.5438 15.0918C18.5122 15.3685 18.4044 15.631 18.2324 15.8499C18.034 16.0991 17.795 16.231 17.4804 16.2647C16.8184 16.3349 15.5376 16.0168 13.1868 14.097C12.3172 13.3859 11.2384 12.9796 10.1157 12.9404C10.034 12.9378 9.96673 12.9378 9.88688 12.9404C8.76423 12.9796 7.68541 13.3859 6.81583 14.097C4.46448 16.0171 3.18398 16.3349 2.52224 16.2647C2.20739 16.231 1.96838 16.0991 1.76997 15.8499C1.68384 15.7415 1.61361 15.6214 1.5614 15.4932C1.51809 15.3859 1.48683 15.2743 1.4682 15.1601C1.43892 14.9795 1.33908 14.818 1.19067 14.711C1.04225 14.604 0.857411 14.5603 0.676806 14.5896C0.496201 14.6189 0.334627 14.7187 0.227629 14.8671C0.120631 15.0155 0.0769724 15.2004 0.106259 15.381C0.141554 15.5976 0.201033 15.8095 0.283578 16.0128C0.386459 16.2632 0.524778 16.4975 0.694298 16.7085C1.12531 17.2501 1.69172 17.563 2.3783 17.6357C2.48394 17.647 2.59011 17.6526 2.69635 17.6525C4.00676 17.6525 5.64563 16.8353 7.69015 15.165C8.32511 14.6449 9.11313 14.3475 9.93335 14.3184C9.98355 14.3171 10.0236 14.3168 10.0757 14.3184C10.8952 14.3478 11.6824 14.6451 12.3167 15.1647C14.5311 16.9731 16.2715 17.7818 17.6294 17.6354C18.3157 17.5617 18.8821 17.2498 19.3118 16.7082C19.6434 16.2894 19.8518 15.7864 19.9137 15.2557C20.0961 13.7328 20.2379 7.55943 17.5957 5.18111Z"
                                fill="currentColor"
                              />
                              <path
                                d="M5.47201 7.6665C5.3815 7.6665 5.29187 7.68433 5.20825 7.71897C5.12462 7.75361 5.04864 7.80438 4.98464 7.86838C4.92064 7.93238 4.86987 8.00837 4.83523 8.09199C4.80059 8.17561 4.78276 8.26524 4.78276 8.35575V9.35291H3.78561C3.69393 9.35111 3.60282 9.3676 3.5176 9.40144C3.43238 9.43527 3.35477 9.48576 3.2893 9.54996C3.22383 9.61415 3.17182 9.69076 3.13631 9.7753C3.10081 9.85983 3.08252 9.9506 3.08252 10.0423C3.08252 10.134 3.10081 10.2248 3.13631 10.3093C3.17182 10.3938 3.22383 10.4704 3.2893 10.5346C3.35477 10.5988 3.43238 10.6493 3.5176 10.6831C3.60282 10.717 3.69393 10.7335 3.78561 10.7317H4.78276V11.7288C4.78096 11.8205 4.79745 11.9116 4.83129 11.9968C4.86512 12.0821 4.91561 12.1597 4.97981 12.2251C5.044 12.2906 5.12061 12.3426 5.20515 12.3781C5.28968 12.4136 5.38045 12.4319 5.47214 12.4319C5.56384 12.4319 5.65461 12.4136 5.73914 12.3781C5.82368 12.3426 5.90029 12.2906 5.96448 12.2251C6.02868 12.1597 6.07917 12.0821 6.113 11.9968C6.14684 11.9116 6.16333 11.8205 6.16153 11.7288V10.7317H7.15869C7.33917 10.7281 7.51107 10.6539 7.63745 10.525C7.76384 10.3961 7.83463 10.2228 7.83463 10.0423C7.83463 9.86177 7.76384 9.68845 7.63745 9.55955C7.51107 9.43065 7.33917 9.35646 7.15869 9.35291H6.16153V8.35575C6.16153 8.26522 6.14369 8.17557 6.10904 8.09193C6.07438 8.00829 6.02359 7.93229 5.95956 7.86829C5.89553 7.80428 5.81951 7.75352 5.73586 7.71889C5.6522 7.68427 5.56255 7.66647 5.47201 7.6665V7.6665Z"
                                fill="currentColor"
                              />
                              <path
                                d="M14.623 7.69141C14.4704 7.69141 14.3212 7.73666 14.1944 7.82145C14.0675 7.90623 13.9686 8.02674 13.9102 8.16773C13.8518 8.30872 13.8366 8.46385 13.8663 8.61352C13.8961 8.76318 13.9696 8.90065 14.0776 9.00854C14.1855 9.11642 14.323 9.18988 14.4727 9.21962C14.6223 9.24935 14.7775 9.23404 14.9184 9.1756C15.0594 9.11717 15.1799 9.01824 15.2646 8.89134C15.3494 8.76443 15.3946 8.61524 15.3945 8.46264C15.3943 8.25812 15.3129 8.06203 15.1683 7.91744C15.0236 7.77284 14.8275 7.69155 14.623 7.69141Z"
                                fill="currentColor"
                              />
                              <path
                                d="M14.623 12.5254C15.0491 12.5254 15.3945 12.18 15.3945 11.7539C15.3945 11.3278 15.0491 10.9824 14.623 10.9824C14.1969 10.9824 13.8515 11.3278 13.8515 11.7539C13.8515 12.18 14.1969 12.5254 14.623 12.5254Z"
                                fill="currentColor"
                              />
                              <path
                                d="M13.0965 9.33691C12.9439 9.33691 12.7948 9.38216 12.6679 9.46694C12.541 9.55171 12.4421 9.6722 12.3837 9.81317C12.3253 9.95415 12.3101 10.1093 12.3398 10.2589C12.3696 10.4086 12.4431 10.5461 12.551 10.6539C12.6589 10.7618 12.7963 10.8353 12.946 10.8651C13.0957 10.8949 13.2508 10.8796 13.3918 10.8212C13.5327 10.7628 13.6532 10.6639 13.738 10.537C13.8228 10.4102 13.868 10.261 13.868 10.1084C13.8678 9.90386 13.7865 9.70775 13.6418 9.56312C13.4972 9.41848 13.3011 9.33713 13.0965 9.33691V9.33691Z"
                                fill="currentColor"
                              />
                              <path
                                d="M16.0762 10.8799C16.2288 10.8799 16.3779 10.8347 16.5048 10.7499C16.6317 10.6651 16.7306 10.5446 16.789 10.4037C16.8474 10.2627 16.8626 10.1076 16.8329 9.9579C16.8031 9.80825 16.7296 9.67078 16.6217 9.56288C16.5138 9.45499 16.3764 9.38151 16.2267 9.35174C16.077 9.32197 15.9219 9.33725 15.7809 9.39564C15.64 9.45403 15.5195 9.55292 15.4347 9.67979C15.3499 9.80666 15.3047 9.95583 15.3047 10.1084C15.3049 10.313 15.3863 10.5091 15.5309 10.6537C15.6755 10.7984 15.8716 10.8797 16.0762 10.8799V10.8799Z"
                                fill="currentColor"
                              />
                            </g>
                            <defs>
                              <clipPath id="clip0_413_4859">
                                <rect
                                  width={20}
                                  height="13.6523"
                                  fill="currentColor"
                                  transform="translate(0 4)"
                                />
                              </clipPath>
                            </defs>
                          </svg>
                        </span>
                        <span className="tw-text-white-1 tw-ml-2 Sidebar_label__3Wp_O">
                          Eden Games
                        </span>
                        <span className="tw-ml-auto">
                          <svg
                            stroke="currentColor"
                            fill="none"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            color="#504759"
                            className="tw-transform"
                            height={24}
                            width={24}
                            xmlns="http://www.w3.org/2000/svg"
                            style={{ color: "rgb(80, 71, 89)" }}
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </span>
                      </div>
                      <div className="tw-pl-10 Sidebar_subMenu__Lf3_F">
                        <ul>
                          <li className="tw-w-auto">
                            <a href="#">
                              <div className="tw-flex tw-justify-between">
                                <span>Mini Royale</span>
                              </div>
                            </a>
                          </li>
                          <li className="tw-w-auto">
                            <a href="#">
                              <div className="tw-flex tw-justify-between">
                                <span>Panzerdogs</span>
                              </div>
                            </a>
                          </li>
                          <li className="tw-w-auto">
                            <a href="#">
                              <div className="tw-flex tw-justify-between">
                                <span>bracketX by Overtime</span>
                              </div>
                            </a>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </li>
                  <li className="Sidebar_tab__3vTzz tw-rounded-sm tw-text-white-1 tw-cursor-pointer tw-min-w-200px">
                    <div className="tw-flex tw-flex-col">
                      <div className="tw-flex tw-p-3 hover:tw-bg-gray-300 tw-relative tw-rounded">
                        <span>
                          <svg
                            stroke="currentColor"
                            fill="none"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            color="#F5F3F7"
                            width="20px"
                            height="20px"
                            xmlns="http://www.w3.org/2000/svg"
                            style={{ color: "rgb(245, 243, 247)" }}
                          >
                            <circle cx={12} cy={8} r={7} />
                            <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline>
                          </svg>
                        </span>
                        <span className="tw-text-white-1 tw-ml-2 Sidebar_label__3Wp_O">
                          Creators
                        </span>
                        <span className="tw-ml-auto">
                          <svg
                            stroke="currentColor"
                            fill="none"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            color="#504759"
                            className="tw-transform"
                            height={24}
                            width={24}
                            xmlns="http://www.w3.org/2000/svg"
                            style={{ color: "rgb(80, 71, 89)" }}
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </span>
                      </div>
                    </div>
                  </li>
                  <li className="Sidebar_tab__3vTzz tw-rounded-sm tw-text-white-1 tw-cursor-pointer tw-min-w-200px">
                    <div className="tw-flex tw-flex-col">
                      <div className="tw-flex tw-p-3 hover:tw-bg-gray-300 tw-relative tw-rounded">
                        <span>
                          <svg
                            stroke="currentColor"
                            fill="none"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            color="#F5F3F7"
                            width="20px"
                            height="20px"
                            xmlns="http://www.w3.org/2000/svg"
                            style={{ color: "rgb(245, 243, 247)" }}
                          >
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                            <circle cx={9} cy={7} r={4} />
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                          </svg>
                        </span>
                        <span className="tw-text-white-1 tw-ml-2 Sidebar_label__3Wp_O">
                          Community
                        </span>
                        <span className="tw-ml-auto">
                          <svg
                            stroke="currentColor"
                            fill="none"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            color="#504759"
                            className="tw-transform"
                            height={24}
                            width={24}
                            xmlns="http://www.w3.org/2000/svg"
                            style={{ color: "rgb(80, 71, 89)" }}
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </span>
                      </div>
                    </div>
                  </li>
                  <li className="Sidebar_tab__3vTzz tw-rounded-sm tw-text-white-1 tw-cursor-pointer tw-min-w-200px">
                    <div className="tw-flex tw-flex-col">
                      <a
                        target="_blank"
                        className="tw-flex tw-p-3 tw-relative tw-rounded"
                        href="https://intercom.help/magiceden/en"
                      >
                        <span>
                          <svg
                            stroke="currentColor"
                            fill="none"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            color="#F5F3F7"
                            width="20px"
                            height="20px"
                            xmlns="http://www.w3.org/2000/svg"
                            style={{ color: "rgb(245, 243, 247)" }}
                          >
                            <circle cx={12} cy={12} r={10} />
                            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                            <line x1={12} y1={17} x2="12.01" y2={17} />
                          </svg>
                        </span>
                        <span className="tw-text-white-1 tw-ml-2 Sidebar_label__3Wp_O">
                          Help Desk
                        </span>
                      </a>
                    </div>
                  </li>
                  <li className="Sidebar_tab__3vTzz tw-rounded-sm tw-text-white-1 tw-cursor-pointer tw-min-w-200px">
                    <div className="tw-flex tw-flex-col">
                      <a
                        target="_blank"
                        className="tw-flex tw-p-3 tw-relative tw-rounded"
                        href="https://careers.magiceden.io/jobs"
                      >
                        <span>
                          <svg
                            stroke="currentColor"
                            fill="none"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            color="#F5F3F7"
                            width="20px"
                            height="20px"
                            xmlns="http://www.w3.org/2000/svg"
                            style={{ color: "rgb(245, 243, 247)" }}
                          >
                            <rect
                              x={2}
                              y={7}
                              width={20}
                              height={14}
                              rx={2}
                              ry={2}
                            />
                            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                          </svg>
                        </span>
                        <span className="tw-text-white-1 tw-ml-2 Sidebar_label__3Wp_O">
                          Careers
                        </span>
                      </a>
                    </div>
                  </li>
                  <li className="Sidebar_tab__3vTzz tw-rounded-sm tw-text-white-1 tw-cursor-pointer tw-min-w-200px">
                    <div className="tw-flex tw-flex-col">
                      <div className="tw-flex tw-p-3 hover:tw-bg-gray-300 tw-relative tw-rounded">
                        <span>
                          <svg
                            stroke="currentColor"
                            fill="none"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            color="#F5F3F7"
                            width="20px"
                            height="20px"
                            xmlns="http://www.w3.org/2000/svg"
                            style={{ color: "rgb(245, 243, 247)" }}
                          >
                            <line x1={21} y1={10} x2={3} y2={10} />
                            <line x1={21} y1={6} x2={3} y2={6} />
                            <line x1={21} y1={14} x2={3} y2={14} />
                            <line x1={21} y1={18} x2={3} y2={18} />
                          </svg>
                        </span>
                        <span className="tw-text-white-1 tw-ml-2 Sidebar_label__3Wp_O">
                          More
                        </span>
                        <span className="tw-ml-auto">
                          <svg
                            stroke="currentColor"
                            fill="none"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            color="#504759"
                            className="tw-transform"
                            height={24}
                            width={24}
                            xmlns="http://www.w3.org/2000/svg"
                            style={{ color: "rgb(80, 71, 89)" }}
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </span>
                      </div>
                    </div>
                  </li>
                </ul>
              </div>
            </div>
            <div className="tw-relative tw-flex tw-flex-col tw-flex-auto tw-ml-0 content__regular lg:tw-ml-240px">
              <div className="tw-max-w-screen-3xl tw-mx-auto tw-my-4 tw-w-full tw-px-8">
                <div className="tw-flex tw-flex-1 tw-flex-col-reverse md:tw-flex-row tw-mx-auto tw-gap-8 tw-justify-between">
                  <div className="tw-flex tw-flex-col tw-gap-4 tw-flex-grow md:tw-max-w-[40%]">
                    <div className="tw-text-pink-primary fs-12px tw-border tw-border-solid tw-border-pink-primary tw-rounded-md tw-px-2 tw-py-1 tw-w-fit-content tw-tracking-widest">
                      FEATURED LAUNCH
                    </div>
                    <h1 className="mt-1 tw-text-[58px] tw-font-extrabold tw-leading-none">
                                                        Trippin’ Ape Tribe
                    </h1>
                    <div className="tw-inline-flex tw-gap-2 tw-content-center tw-w-fit-content tw-flex-wrap">
                      <div
                        className="tw-my-auto"
                        data-tooltipped=""
                        aria-describedby="tippy-tooltip-1"
                        data-original-title="doxxed"
                        style={{ display: "inline" }}
                      >
                        <div className="tw-text-pink-primary fs-12px tw-h-fit-content tw-my-auto tw-border tw-border-solid tw-border-pink-primary tw-rounded-md tw-px-2 tw-py-1 tw-w-fit-content tw-tracking-widest">
                          DOXXED
                        </div>
                      </div>
                      <div
                        className="tw-my-auto"
                        data-tooltipped=""
                        aria-describedby="tippy-tooltip-2"
                        data-original-title="escrow1d"
                        style={{ display: "inline" }}
                      >
                        <div className="tw-text-pink-primary fs-12px tw-h-fit-content tw-my-auto tw-border tw-border-solid tw-border-pink-primary tw-rounded-md tw-px-2 tw-py-1 tw-w-fit-content tw-tracking-widest">
                          ESCROW 1d
                        </div>
                      </div>
                                                       
                      
                      <div className="tw-border tw-border-solid tw-border-purple-1 tw-p-2 tw-rounded-md tw-text-white-1 tw-h-fit-content tw-text-[14px] tw-flex tw-gap-2 tw-whitespace-nowrap">
                        <span className="tw-font-light">PRICE</span>
                        <span className="tw-font-bold">2◎</span>
                      </div>
                      <div className="tw-flex tw-items-center tw-gap-2">
                        <div
                          className=""
                          data-tooltipped=""
                          aria-describedby="tippy-tooltip-3"
                          data-original-title="Website"
                          style={{ display: "inline" }}
                        >
                          <a
                            target="_blank"
                            rel="noopener noreferrer"
                                                                    href="https://www.trippinapetribe.xyz/"
                          >
                            <img
                              src="./img/globe_white.1cc8238d.svg"
                              className="tw-w-6 tw-h-6 hover:tw-opacity-80"
                            />
                          </a>
                        </div>
                        <div
                          className=""
                          data-tooltipped=""
                          aria-describedby="tippy-tooltip-4"
                          data-original-title="Discord"
                          style={{ display: "inline" }}
                        >
                          <a
                            target="_blank"
                            rel="noopener noreferrer"
                                                                    href="https://discord.com/invite/trippinapetribe"
                          >
                            <img
                              src="./img/discord_white.a80cd7b6.svg"
                              className="tw-w-6 tw-h-6 hover:tw-opacity-80"
                            />
                          </a>
                        </div>
                        <div
                          className=""
                          data-tooltipped=""
                          aria-describedby="tippy-tooltip-5"
                          data-original-title="Twitter"
                          style={{ display: "inline" }}
                        >
                          <a
                            target="_blank"
                            rel="noopener noreferrer"
                                                                    href="https://twitter.com/TrippinApeNFT"
                          >
                            <img
                              src="./img/twitter_white.646bf11e.svg"
                              className="tw-w-6 tw-h-6 hover:tw-opacity-80"
                            />
                          </a>
                        </div>
                      </div>
                    </div>
                    <p className="tw-mb-4 tw-text-gray-light">
                                                        Trippin' Ape Tribe is a community-first PFP project on Solana,
                                                        backed by strong and ownable branding, cheeky storytelling, innovative long-term utility,
                                                        and a passionate community of free-thinking degens.

                                                        10,000 Apes have fallen under the trance of a mysterious yet charismatic leader,
                                                        Chorles, but don’t worry… it's definitely not a cult.
                    </p>
                    <div className="tw-flex tw-flex-col tw-gap-4">
                      <div
                        className=""
                        data-tooltipped=""
                        aria-describedby="tippy-tooltip-9"
                        data-original-title="Whitelist"
                        style={{ display: "inline" }}
                           >
                        <div className="tw-rounded-xl tw-border tw-border-solid tw-border-purple-1 tw-p-3 tw-flex tw-flex-col tw-gap-6 hover:tw-bg-purple-1 hover:tw-cursor-help">
                          <div className="tw-flex tw-justify-between tw-items-center">
                            <div>
                              <div className="tw-flex tw-items-center">
                                <div className="tw-bg-purple-3 tw-rounded-full tw-py-0.5 tw-px-2 tw-text-white-1 tw-text-[12px] tw-h-fit-content">
                                                                                Whitelist
                                </div>
                              </div>
                            </div>
                            <div className="tw-flex tw-flex-row tw-gap-2 tw-text-pink-hot tw-text-sm tw-tracking-wide tw-font-medium tw-text-center tw-uppercase tw-items-center">
                             Ended
                              <div className="tw-flex tw-gap-2 tw-ml-auto"></div>
                            </div>
                          </div>
                          <div className="tw-flex tw-gap-1.5 tw-text-white-1 tw-tracking-wide tw-text-sm">
                            <span>
                              WHITELIST <b>3333</b>
                            </span>
                            <b>•</b>
                            <span>
                              MAX <b>1 TOKEN</b>
                            </span>
                            <b>•</b>
                            <span>
                              Price <b>1.5◎</b>
                            </span>
                          </div>
                        </div>
                       </div>





                                                       
                                                   


                                                        
                                                        
                      
                      <div
                        className=""
                        data-tooltipped=""
                        aria-describedby="tippy-tooltip-13"
                        data-original-title="Public Sale"
                        style={{ display: "inline" }}
                      >
                        <div className="tw-rounded-xl tw-border tw-border-solid tw-border-purple-1 tw-p-3 tw-flex tw-flex-col tw-gap-6 hover:tw-bg-purple-1 hover:tw-cursor-help">
                          <div className="tw-flex tw-justify-between tw-items-center">
                            <div>
                              <div className="tw-flex tw-items-center">
                                <div className="tw-bg-purple-3 tw-rounded-full tw-py-0.5 tw-px-2 tw-text-white-1 tw-text-[12px] tw-h-fit-content">
                                  Public Sale
                                </div>
                              </div>
                            </div>
                            <div className="tw-flex tw-flex-row tw-gap-2 tw-text-pink-hot tw-text-sm tw-tracking-wide tw-font-medium tw-text-center tw-uppercase tw-items-center">
                              In progress
                              <div className="tw-flex tw-gap-2 tw-ml-auto"></div>
                            </div>
                          </div>
                          <div className="tw-flex tw-gap-1.5 tw-text-white-1 tw-tracking-wide tw-text-sm">
                            <span>
                              MAX <b>2 TOKENS</b>
                            </span>
                            <b>•</b>
                            <span>
                              Price <b>2◎</b>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="md:tw-max-w-[50%] tw-flex tw-flex-col tw-items-center tw-w-full tw-flex-grow tw-self-stretch">
                    <div className="overflow-hidden tw-w-full tw-mb-4 tw-flex-grow tw-rounded-3xl">
                      <div>
                        <img
                                                                src="./img/project.jpg"
                          alt="Cynova"
                          className="tw-object-cover tw-aspect-square tw tw-w-screen tw-flex-grow tw-rounded-3xl overflow-hidden"
                        />
                        <img
                                                                src="./img/project.jpg"
                          width={1}
                          height={1}
                          className="tw-absolute tw-invisible"
                        />
                      </div>
                    </div>
                    <div className="tw-w-full">
                      <div className="tw-flex tw-flex-col tw-gap-1 tw-flex-grow 3xl:tw-hidden">
                        <div className="tw-flex tw-items-center tw-justify-between tw-text-[14px] tw-text-gray-5">
                          <span className="">Total minted</span>
                          <span>
                            <b className="tw-text-white-1">95%</b> (9518/10000)
                          </span>
                        </div>
                        <div className="progress-bar__container">
                          <div
                            className="progress-bar__value"
                            style={{ width: "95%" }}
                          />
                        </div>
                      </div>
                      <div className="tw-flex tw-gap-4 tw-items-center tw-justify-between tw-flex-wrap tw-rounded-lg tw-bg-purple-2 tw-p-4 tw-mt-4">
                        <div className="tw-flex tw-gap-4 tw-mx-auto tw-flex-col tw-w-full tw-items-center">
                          <div className="tw-flex tw-justify-between tw-gap-6 3xl:tw-w-full">
                            <div id="root" style={{ display: "flex" }}>
                              <main>
                                <div className="sc-dlfnuX bJgQKs">
                                  <button
                                    className="lowMintButton MuiButtonBase-root MuiButton-root MuiButton-contained sc-bdfBQB kKVOCU MuiButton-containedPrimary"
                                    tabIndex={0}
                                    type="button"
                                  >
                                    <span className="MuiButton-label">
                                    <MintButtonContainer>
                                {!isActive && !isEnded && candyMachine?.state.goLiveDate && (!isWLOnly || whitelistTokenBalance > 0) ? (
                                    <Countdown
                                        date={toDate(candyMachine?.state.goLiveDate)}
                                        onMount={({completed}) => completed && setIsActive(!isEnded)}
                                        onComplete={() => {
                                            setIsActive(!isEnded);
                                        }}
                                        renderer={renderGoLiveDateCounter}
                                    />) : (
                                    !wallet ? (
                                            <ConnectButton>Connect Wallet</ConnectButton>
                                        ) : (!isWLOnly || whitelistTokenBalance > 0) ?
                                        candyMachine?.state.gatekeeper &&
                                        wallet.publicKey &&
                                        wallet.signTransaction ? (
                                            <GatewayProvider
                                                wallet={{
                                                    publicKey:
                                                        wallet.publicKey ||
                                                        new PublicKey(CANDY_MACHINE_PROGRAM),
                                                    //@ts-ignore
                                                    signTransaction: wallet.signTransaction,
                                                }}
                                                // // Replace with following when added
                                                // gatekeeperNetwork={candyMachine.state.gatekeeper_network}
                                                gatekeeperNetwork={
                                                    candyMachine?.state?.gatekeeper?.gatekeeperNetwork
                                                } // This is the ignite (captcha) network
                                                /// Don't need this for mainnet
                                                clusterUrl={rpcUrl}
                                                options={{autoShowModal: false}}
                                            >
                                                <MintButton
                                                    candyMachine={candyMachine}
                                                    isMinting={isMinting}
                                                    isActive={isActive}
                                                    isEnded={isEnded}
                                                    isSoldOut={isSoldOut}
                                                    onMint={onMint}
                                                />
                                            </GatewayProvider>
                                        ) : (
                                            <MintButton
                                                candyMachine={candyMachine}
                                                isMinting={isMinting}
                                                isActive={isActive}
                                                isEnded={isEnded}
                                                isSoldOut={isSoldOut}
                                                onMint={onMint}
                                            />
                                        ) :
                                        <h1>Mint is private.</h1>
                                        )}
                            </MintButtonContainer>
                                    </span>
                                    <span className="MuiTouchRipple-root" />
                                  </button>
                                </div>
                              </main>
                            </div>
                            <div className="tw-flex tw-flex-col tw-gap-1 tw-flex-grow tw-hidden 3xl:tw-flex tw-flex-col-reverse tw-self-center">
                              <div className="tw-flex tw-items-center tw-justify-between tw-text-[14px] tw-text-gray-5">
                                <span className="">Total minted</span>
                                <span>
                                  <b className="tw-text-white-1">95%</b>
                                  (2110/2222)
                                </span>
                              </div>
                              <div className="progress-bar__container">
                                <div
                                  className="progress-bar__value"
                                  style={{ width: "95%" }}
                                ></div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="">
                  <div className="tw-w-full tw-h-[1px] tw-border tw-border-solid tw-border-purple-1 tw-mt-12 tw-mb-4 lg:tw-mt-32 lg:tw-mb-10"></div>
                </div>
                <div>
                  <div className="tw-flex tw-flex-1 tw-flex-col md:tw-flex-row tw-mx-auto tw-gap-32 tw-pb-20 tw-justify-between">
                    <div className="tw-flex tw-flex-col tw-gap-4 tw-flex-grow md:tw-w-[40%]">
                      <h1 className="mt-1 tw-text-[58px] tw-font-extrabold tw-leading-none">
                                                            Trippin’ Ape Tribe
                      </h1>
                      <div className="tw-flex tw-flex-wrap tw-gap-4">
                        <a
                                                                href="https://www.trippinapetribe.xyz/trippin-ape-tribe-journal.pdf"
                          target="_blank"
                          rel="noreferrer noopener"
                          className="tw-border tw-border-solid tw-border-purple-1 tw-flex tw-items-center tw-gap-2 tw-w-fit tw-rounded-full tw-px-2.5 tw-py-1.5 tw-text-white-2"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width={20}
                            height={20}
                            fill="none"
                            viewBox="0 0 20 20"
                            color="#e42575"
                          >
                            <path
                              stroke="#F5F3F7"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M15 10.833v5a1.666 1.666 0 01-1.667 1.667H4.167A1.667 1.667 0 012.5 15.833V6.667A1.667 1.667 0 014.167 5h5M12.5 2.5h5v5M8.332 11.667L17.499 2.5"
                            />
                          </svg>
                          <span>Whitepaper</span>
                        </a>
                        <a
                                                                href="https://www.trippinapetribe.xyz/"
                          target="_blank"
                          rel="noreferrer noopener"
                          className="tw-border tw-border-solid tw-border-purple-1 tw-flex tw-items-center tw-gap-2 tw-w-fit tw-rounded-full tw-px-2.5 tw-py-1.5 tw-text-white-2"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width={20}
                            height={20}
                            fill="none"
                            viewBox="0 0 20 20"
                            color="#e42575"
                          >
                            <path
                              stroke="#F5F3F7"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M15 10.833v5a1.666 1.666 0 01-1.667 1.667H4.167A1.667 1.667 0 012.5 15.833V6.667A1.667 1.667 0 014.167 5h5M12.5 2.5h5v5M8.332 11.667L17.499 2.5"
                            />
                          </svg>
                          <span>Website</span>
                        </a>
                        <a
                                                                href="https://discord.com/invite/trippinapetribe"
                          target="_blank"
                          rel="noreferrer noopener"
                          className="tw-border tw-border-solid tw-border-purple-1 tw-flex tw-items-center tw-gap-2 tw-w-fit tw-rounded-full tw-px-2.5 tw-py-1.5 tw-text-white-2"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width={20}
                            height={20}
                            fill="none"
                            viewBox="0 0 20 20"
                            color="#e42575"
                          >
                            <path
                              stroke="#F5F3F7"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M15 10.833v5a1.666 1.666 0 01-1.667 1.667H4.167A1.667 1.667 0 012.5 15.833V6.667A1.667 1.667 0 014.167 5h5M12.5 2.5h5v5M8.332 11.667L17.499 2.5"
                            />
                          </svg>
                          <span>Discord</span>
                        </a>
                        <a
                                                                href="https://twitter.com/TrippinApeNFT"
                          target="_blank"
                          rel="noreferrer noopener"
                          className="tw-border tw-border-solid tw-border-purple-1 tw-flex tw-items-center tw-gap-2 tw-w-fit tw-rounded-full tw-px-2.5 tw-py-1.5 tw-text-white-2"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width={20}
                            height={20}
                            fill="none"
                            viewBox="0 0 20 20"
                            color="#e42575"
                          >
                            <path
                              stroke="#F5F3F7"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M15 10.833v5a1.666 1.666 0 01-1.667 1.667H4.167A1.667 1.667 0 012.5 15.833V6.667A1.667 1.667 0 014.167 5h5M12.5 2.5h5v5M8.332 11.667L17.499 2.5"
                            />
                          </svg>
                          <span>Twitter</span>
                        </a>
                      </div>
                      <div>
                        
                        <p className="tw-text-gray-light tw-mb-3 tw-text-[16] tx-line-[24]">
                                                                At some point in our inconsequential existence, we
                                                                were just your ordinary apes: kickin it in trees, eating
                                                                bananas and shit (just to be clear, no, I don’t mean we
                                                                were eating shit). Everything changed when a bunch of spunions
                                                                came to our island blaring strange sounds and strands of
                                                                fire in the sky for something called Fire Festival 2.

                                                                These strange beings seemed to be entranced, hypnotized by
                                                                sonic beats. We observed from a distance and noticed the mood
                                                                started to change. When their food and water went dry and
                                                                their performers stopped showing up, these pompous savages began to devolve.

                                                                The debauchery reached a fever pitch when one we could assume to be their chief,
                                                                Ja Ruler, started screaming at everybody and demanding some dude suck
                                                                dick for water. Idk, shit got pretty weird. Eventually, the scene
                                                                turned into complete and utter chaos, leading all of them to
                                                                frantically leave the island. The event turned out to be a
                                                                disaster—for them, at least.

                                                                After everyone fled, we started scavenging the wasteland those trust fund
                                                                babies left behind. It was mostly deflated mattresses and baloney
                                                                sandwiches with a scared spunion hiding in the crevices. We looked
                                                                through their refugee tents until one of the alphas, Chorles, found
                                                                a mysterious piece of luggage. He inspected it to ensure the safety
                                                                of the rest of the apes before taking it back to his dwelling.

                                                                Months had passed with very little sighting of Chorles, when he popped
                                                                up out of nowhere, announcing that he needed some volunteers for what
                                                                he called the “clinical trials.” The initial group of volunteers
                                                                would become Chorles’ disciples. At first, us apes were wary,
                                                                but Chorles’ disciples seemed to be in a tranquil state after every session.
                                                            </p>


                                                          



                      </div>
                        </div>


                    <div className="tw-flex tw-flex-col tw-gap-4 tw-flex-grow md:tw-w-[50%]">
                      <div className="tw-w-full tw-self-stretch">
                        <div className="tw-flex tw-gap-8 lg:tw-gap-16">
                          <div className="tw-relative me-tab2 tw-flex tw-cursor-pointer tw-mr-2 tw-py-2 tw-px-4 is-active tw-text-white-2 tw-font-medium tw-text-lg">
                            <span className="me-tab2-title">Roadmap</span>
                          </div>
                          <div className="tw-relative me-tab2 tw-flex tw-cursor-pointer tw-mr-2 tw-py-2 tw-px-4 tw-text-white-2 tw-font-medium tw-text-lg">
                            <span className="me-tab2-title">Team</span>
                          </div>
                        </div>
                                                        </div>


                      <div className="tw-p-4">
                        <div className="tw-p-4">
                          <div className="tw-my-1">
                            <p className="tw-text-gray-light tw-text-md tw-text-[14px]">
                                                                        I
                                                                        Community
                            </p>
                            <br />
                          </div>
                          <div className="tw-my-1">
                                                                    <p className="tw-text-gray-light tw-text-md tw-text-[14px]">
                                                                        It may not be a cult, but we did set out to build
                                                                        the most tight-knit, empowered community on Solana.
                                                                        Everything we do
                                                                        — from our branding choices to our utilities to the way
                                                                        we reveal details about the project
                                                                        — has been carefully engineered to build hype,
                                                                        drive engagement, and create opportunities for the
                                                                        Tribe to connect deeply. We believe in strength in numbers.
                                                                        Apes ascend as one.

                            </p>
                            <br />
                          </div>
                         
                          <div className="tw-my-1">
                            <p className="tw-text-gray-light tw-text-md tw-text-[14px]">
                                                                        II
                                                                        Identity
                            </p>
                            <br />
                          </div>
                          <div className="tw-my-1">
                                                                    <p className="tw-text-gray-light tw-text-md tw-text-[14px]">
                                                                        An important part of building a powerful cult…ure
                                                                        is knowing what we are and what we aren’t.
                                                                        Trippin’ Ape Tribe is a community built by and for
                                                                        free-thinking degens. By embracing our true nature,
                                                                        we welcome in genuine creative inspiration and
                                                                        new strategic partnerships with like-minded brands
                                                                        and collaborators that can all spread the mission
                                                                        further.
                            </p>
                            <br />
                          </div>
                          
                          
                          <div className="tw-my-1">
                            <p className="tw-text-gray-light tw-text-md tw-text-[14px]">
                                                                        III
                                                                        Innovation
                            </p>
                            <br />
                          </div>
                          <div className="tw-my-1">
                                                                    <p className="tw-text-gray-light tw-text-md tw-text-[14px]">
                                                                        Thanks to Chorles and his infinite wisdom,
                                                                        our consciousness continues to expand,
                                                                        illuminating possibilities where once we only saw limits.
                                                                        We will continue to bring big-brain thinking and
                                                                        next-level utilities to the project to keep our
                                                                        Tribe guessing and the Solana ecosystem moving forward.
                                                                        Trust the process.
                            </p>
                            <br />
                          </div>
                          





                                                             
                                                               





                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  className="modal fade"
                  tabIndex={-1}
                  role="dialog"
                  aria-labelledby="modal"
                  aria-hidden="true"
                  style={{ backdropFilter: "blur(20px)" }}
                >
                  <div
                    className="modal-dialog modal-dialog-centered"
                    role="document"
                  >
                    <div className="modal-content position-relative tw-bg-gray-100 tw-rounded-xl tw-p-4 tw-border-gray-500">
                      <div className="modal-body">
                        <div className="tw-flex tw-flex-col tw-w-full tw-items-center">
                          <div className="tw-flex tw-flex-col tw-items-center tw-text-center tw-text-white-2">
                            <p>
                              I acknowledge that I decide the validity and
                              worthiness of a launchpad project by deciding to
                              mint. There's a risk that, despite a creator's
                              best efforts, their promises may not be fulfilled.
                              I will do my own research to make the best
                              informed decision.
                            </p>
                            <div className="tw-mt-10">
                              <button
                                type="button"
                                className="tw-inline-flex tw-justify-center tw-items-center tw-rounded-md tw-text-white-1 PlainButton_btn__24zB_ tw-mr-2 PlainButton_transparent__1quxP"
                              >
                                I understand
                              </button>
                              <button
                                type="button"
                                className="tw-inline-flex tw-justify-center tw-items-center tw-rounded-md tw-text-white-1 PlainButton_btn__24zB_ PlainButton_transparent__1quxP"
                              >
                                Take me back
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div at-magnifier-wrapper="">
    <div className="at-theme-dark">
      <div className="at-base notranslate" translate="no" />
    </div>
  </div>

  <div className="q-notifications">
    <div className="q-notifications__list q-notifications__list--top fixed column no-wrap items-start" />
    <div className="q-notifications__list q-notifications__list--top fixed column no-wrap items-end" />
    <div className="q-notifications__list q-notifications__list--bottom fixed column no-wrap items-start" />
    <div className="q-notifications__list q-notifications__list--bottom fixed column no-wrap items-end" />
    <div className="q-notifications__list q-notifications__list--top fixed column no-wrap items-center" />
    <div className="q-notifications__list q-notifications__list--bottom fixed column no-wrap items-center" />
    <div className="q-notifications__list q-notifications__list--center fixed column no-wrap items-start justify-center" />
    <div className="q-notifications__list q-notifications__list--center fixed column no-wrap items-end justify-center" />
    <div className="q-notifications__list q-notifications__list--center fixed column no-wrap flex-center" />
  </div>
</>


</main>
    );
};

export default Home;
