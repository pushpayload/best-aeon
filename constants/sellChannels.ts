interface SellChannel {
  [key: string]: {
    region: string
  }
}

const sellChannels: SellChannel = {
  // instant-sells
  '1273339659836985405': { region: 'EU' },
  // scheduled-raids
  '1273339740581793823': { region: 'EU' },
  // scheduled-strikes
  '1273339789609013350': { region: 'EU' },
  // scheduled-fractals
  '1273339840519340062': { region: 'EU' },
  // na-scheduled-raids
  '1273339891295715348': { region: 'NA' },
  // na-scheduled-strikes
  '1273339930499743795': { region: 'NA' },

  // BTB
  // instant-sales
  // "1249829604974268418": { region: "EU" },
  // sells
  // "1263079097408688155": { region: "NA" },
}

export default sellChannels
