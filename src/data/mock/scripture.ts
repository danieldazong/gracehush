// Verified Berean Standard Bible text for the mock entries. Fetched from the HelloAO Bible API while
// authoring step 06 and pasted exactly as the API returns it. Never write verse text from memory.
export const bsb = {
  // https://bible.helloao.org/api/BSB/PHP/4.json (verses 6–7)
  "Philippians 4:6–7": "Be anxious for nothing, but in everything, by prayer and petition, with thanksgiving, present your requests to God. And the peace of God, which surpasses all understanding, will guard your hearts and your minds in Christ Jesus.",
  // https://bible.helloao.org/api/BSB/MAT/11.json (verses 28–30)
  "Matthew 11:28–30": "Come to Me, all you who are weary and burdened, and I will give you rest. Take My yoke upon you and learn from Me, for I am gentle and humble in heart, and you will find rest for your souls. For My yoke is easy and My burden is light.”",
  // https://bible.helloao.org/api/BSB/PSA/103.json (verses 1–5)
  "Psalm 103:1–5": "Bless the LORD, O my soul; all that is within me, bless His holy name. Bless the LORD, O my soul, and do not forget all His kind deeds— He who forgives all your iniquities and heals all your diseases, who redeems your life from the Pit and crowns you with loving devotion and compassion, who satisfies you with good things, so that your youth is renewed like the eagle’s.",
  // https://bible.helloao.org/api/BSB/ROM/15.json (verses 13)
  "Romans 15:13": "Now may the God of hope fill you with all joy and peace as you believe in Him, so that you may overflow with hope by the power of the Holy Spirit.",
  // https://bible.helloao.org/api/BSB/PSA/91.json (verses 4)
  "Psalm 91:4": "He will cover you with His feathers; under His wings you will find refuge; His faithfulness is a shield and rampart.",
  // https://bible.helloao.org/api/BSB/COL/3.json (verses 12)
  "Colossians 3:12": "Therefore, as the elect of God, holy and beloved, clothe yourselves with hearts of compassion, kindness, humility, gentleness, and patience.",
  // https://bible.helloao.org/api/BSB/PRO/3.json (verses 24)
  "Proverbs 3:24": "When you lie down, you will not be afraid; when you rest, your sleep will be sweet.",
  // https://bible.helloao.org/api/BSB/ROM/12.json (verses 18)
  "Romans 12:18": "If it is possible on your part, live at peace with everyone.",
  // https://bible.helloao.org/api/BSB/PHP/4.json (verses 19)
  "Philippians 4:19": "And my God will supply all your needs according to His glorious riches in Christ Jesus.",
  // https://bible.helloao.org/api/BSB/ISA/26.json (verses 3)
  "Isaiah 26:3": "You will keep in perfect peace the steadfast of mind, because he trusts in You.",
  // https://bible.helloao.org/api/BSB/PSA/23.json (verses 2)
  "Psalm 23:2": "He makes me lie down in green pastures; He leads me beside quiet waters.",
  // https://bible.helloao.org/api/BSB/MAT/6.json (verses 26)
  "Matthew 6:26": "Look at the birds of the air: They do not sow or reap or gather into barns, and yet your heavenly Father feeds them. Are you not much more valuable than they?",
  // https://bible.helloao.org/api/BSB/PRO/3.json (verses 5–6)
  "Proverbs 3:5–6": "Trust in the LORD with all your heart, and lean not on your own understanding; in all your ways acknowledge Him, and He will make your paths straight.",
  // https://bible.helloao.org/api/BSB/PRO/15.json (verses 1)
  "Proverbs 15:1": "A gentle answer turns away wrath, but a harsh word stirs up anger.",
  // https://bible.helloao.org/api/BSB/ISA/41.json (verses 10)
  "Isaiah 41:10": "Do not fear, for I am with you; do not be afraid, for I am your God. I will strengthen you; I will surely help you; I will uphold you with My righteous right hand.",
  // https://bible.helloao.org/api/BSB/1PE/5.json (verses 7)
  "1 Peter 5:7": "Cast all your anxiety on Him, because He cares for you.",
  // https://bible.helloao.org/api/BSB/JAS/1.json (verses 5)
  "James 1:5": "Now if any of you lacks wisdom, he should ask God, who gives generously to all without finding fault, and it will be given to him.",
  // https://bible.helloao.org/api/BSB/2CO/9.json (verses 8)
  "2 Corinthians 9:8": "And God is able to make all grace abound to you, so that in all things, at all times, having all that you need, you will abound in every good work.",
  // https://bible.helloao.org/api/BSB/PSA/32.json (verses 8)
  "Psalm 32:8": "I will instruct you and teach you the way you should go; I will give you counsel and watch over you.",
  // https://bible.helloao.org/api/BSB/PRO/17.json (verses 17)
  "Proverbs 17:17": "A friend loves at all times, and a brother is born for adversity.",
} as const;

export type BsbReference = keyof typeof bsb;
