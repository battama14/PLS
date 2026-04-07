
export function computeNet(buys,sells){
 return buys - sells
}

export function sentiment(buys,sells){
 const t=buys+sells
 if(t===0) return 50
 return Math.round((buys/t)*100)
}

export function pumpScore(data){

 let score=0

 if(data.whales>2) score+=30
 if(data.liquidity_spike) score+=30
 if(data.volume_spike) score+=20
 if(data.new_wallets>10) score+=20

 return score

}

export function formatPLS(v){

 if(!v) return "0 PLS"

 if(v>1e9) return (v/1e9).toFixed(2)+"B PLS"
 if(v>1e6) return (v/1e6).toFixed(2)+"M PLS"
 if(v>1e3) return (v/1e3).toFixed(2)+"K PLS"

 return v.toFixed(2)+" PLS"

}
