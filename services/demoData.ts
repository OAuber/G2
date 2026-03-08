export const getDemoGedcom = (): string => {
  const lines: string[] = [
    "0 HEAD",
    "1 SOUR LIFETHREAD_DEMO",
    "1 GEDC",
    "2 VERS 5.5.1",
    "2 FORM LINEAGE-LINKED",
    "1 CHAR UTF-8"
  ];

  let indiCounter = 1;
  let famCounter = 1;
  const surnames = ["WINTERS", "SNOW", "FROST", "RIVERS", "STORM", "WOODS", "BLACK", "WHITE"];
  const maleNames = ["Arthur", "William", "Henry", "James", "Thomas", "Edward", "George", "Charles", "Frank", "Louis"];
  const femaleNames = ["Mary", "Anna", "Emma", "Elizabeth", "Minnie", "Margaret", "Ida", "Alice", "Bertha", "Florence"];

  const addIndi = (given: string, surname: string, sex: 'M' | 'F', birth: number, death?: number): string => {
    const id = `@I${indiCounter++}@`;
    lines.push(`0 ${id} INDI`);
    lines.push(`1 NAME ${given} /${surname}/`);
    lines.push(`2 GIVN ${given}`);
    lines.push(`2 SURN ${surname}`);
    lines.push(`1 SEX ${sex}`);
    lines.push(`1 BIRT`);
    lines.push(`2 DATE ${birth}`);
    if (death) {
      lines.push(`1 DEAT`);
      lines.push(`2 DATE ${death}`);
    } else if (birth < 1940) {
      // Assume dead if born long ago
      lines.push(`1 DEAT`);
      lines.push(`2 DATE ${birth + 70 + Math.floor(Math.random() * 20)}`);
    }
    return id;
  };

  const addFam = (husb: string, wife: string, children: string[], marrYear: number): string => {
    const id = `@F${famCounter++}@`;
    lines.push(`0 ${id} FAM`);
    lines.push(`1 HUSB ${husb}`);
    lines.push(`1 WIFE ${wife}`);
    children.forEach(c => lines.push(`1 CHIL ${c}`));
    lines.push(`1 MARR`);
    lines.push(`2 DATE ${marrYear}`);
    
    // Link back
    lines.push(`0 ${husb} INDI`); // Re-open to add link (Simulated, in real GEDCOM usually distinct blocks but parser handles it)
    // Actually our parser is line-by-line stateful. We should inject FAMS into INDI definition or handle it via post-processing logic.
    // To keep this generator simple, we will return the ID and assume the caller logic or standard GEDCOM structure.
    // Standard GEDCOM requires FAMS in INDI record. 
    return id;
  };
  
  // Since we need to modify INDI records to add FAMS/FAMC, we'll build objects first then dump string.
  // Simplified: We just write the full string with known structure.
  
  // Let's restart with a buffer approach
  const buffer: string[] = [...lines];
  const individuals: any[] = [];
  const families: any[] = [];

  const createPerson = (gen: number, birthYear: number, surname: string, gender: 'M' | 'F') => {
      const names = gender === 'M' ? maleNames : femaleNames;
      const given = names[Math.floor(Math.random() * names.length)];
      const lifeExp = 65 + Math.floor(Math.random() * 25);
      const deathYear = (birthYear + lifeExp) > 2024 ? undefined : (birthYear + lifeExp);
      
      const id = `@I${indiCounter++}@`;
      const p = { id, given, surname, gender, birthYear, deathYear, fams: [] as string[], famc: null as string | null };
      individuals.push(p);
      return p;
  };

  // Generation 1 (Roots) - Born ~1850
  const rootDad = createPerson(1, 1850, "WINTERS", 'M');
  const rootMom = createPerson(1, 1855, "SNOW", 'F');
  
  // Generation 2 - Born ~1880 (4 children)
  const gen2: any[] = [];
  for(let i=0; i<4; i++) {
     const p = createPerson(2, 1880 + (i*2), "WINTERS", i % 2 === 0 ? 'M' : 'F');
     p.famc = "@F1@";
     gen2.push(p);
  }

  // Generation 3 - Born ~1910 (Each Gen2 has 3 kids)
  const gen3: any[] = [];
  gen2.forEach((parent) => {
      // Spouse for Gen 2
      const spouse = createPerson(2, parent.birthYear + 2, surnames[Math.floor(Math.random()*surnames.length)], parent.gender === 'M' ? 'F' : 'M');
      
      const famId = `@F${famCounter++}@`;
      parent.fams.push(famId);
      spouse.fams.push(famId);
      
      // Kids
      const numKids = 3;
      const kidsIds: string[] = [];
      for(let k=0; k<numKids; k++) {
          const child = createPerson(3, parent.birthYear + 25 + (k*3), parent.gender === 'M' ? parent.surname : spouse.surname, Math.random() > 0.5 ? 'M' : 'F');
          child.famc = famId;
          gen3.push(child);
          kidsIds.push(child.id);
      }
      
      families.push({ id: famId, husb: parent.gender === 'M' ? parent.id : spouse.id, wife: parent.gender === 'F' ? parent.id : spouse.id, chil: kidsIds, marr: parent.birthYear + 22 });
  });

  // Generation 4 - Born ~1940 (Each Gen3 has 2 kids)
  const gen4: any[] = [];
  gen3.forEach((parent, idx) => {
      // Only marry 80% of them
      if (Math.random() > 0.2) {
        const spouse = createPerson(3, parent.birthYear - 2, surnames[Math.floor(Math.random()*surnames.length)], parent.gender === 'M' ? 'F' : 'M');
        const famId = `@F${famCounter++}@`;
        parent.fams.push(famId);
        spouse.fams.push(famId);
        
        const numKids = 2;
        const kidsIds: string[] = [];
        for(let k=0; k<numKids; k++) {
            const child = createPerson(4, parent.birthYear + 28 + (k*4), parent.gender === 'M' ? parent.surname : spouse.surname, Math.random() > 0.5 ? 'M' : 'F');
            child.famc = famId;
            gen4.push(child);
            kidsIds.push(child.id);
        }
        families.push({ id: famId, husb: parent.gender === 'M' ? parent.id : spouse.id, wife: parent.gender === 'F' ? parent.id : spouse.id, chil: kidsIds, marr: parent.birthYear + 25 });
      }
  });

  // Generation 5 - Born ~1970+
  gen4.forEach((parent) => {
      if (Math.random() > 0.4) {
          const spouse = createPerson(4, parent.birthYear + 1, surnames[Math.floor(Math.random()*surnames.length)], parent.gender === 'M' ? 'F' : 'M');
          const famId = `@F${famCounter++}@`;
          parent.fams.push(famId);
          spouse.fams.push(famId);
          
          const child = createPerson(5, parent.birthYear + 30, parent.gender === 'M' ? parent.surname : spouse.surname, Math.random() > 0.5 ? 'M' : 'F');
          child.famc = famId;
          families.push({ id: famId, husb: parent.gender === 'M' ? parent.id : spouse.id, wife: parent.gender === 'F' ? parent.id : spouse.id, chil: [child.id], marr: parent.birthYear + 28 });
      }
  });
  
  // Link Root Family
  families.push({ id: "@F1@", husb: rootDad.id, wife: rootMom.id, chil: gen2.map(p => p.id), marr: 1875 });
  rootDad.fams.push("@F1@");
  rootMom.fams.push("@F1@");

  // Output to buffer
  individuals.forEach(i => {
      buffer.push(`0 ${i.id} INDI`);
      buffer.push(`1 NAME ${i.given} /${i.surname}/`);
      buffer.push(`2 GIVN ${i.given}`);
      buffer.push(`2 SURN ${i.surname}`);
      buffer.push(`1 SEX ${i.gender}`);
      buffer.push(`1 BIRT`);
      buffer.push(`2 DATE ${i.birthYear}`);
      if (i.deathYear) {
          buffer.push(`1 DEAT`);
          buffer.push(`2 DATE ${i.deathYear}`);
      }
      if (i.famc) buffer.push(`1 FAMC ${i.famc}`);
      i.fams.forEach((f: string) => buffer.push(`1 FAMS ${f}`));
  });

  families.forEach(f => {
      buffer.push(`0 ${f.id} FAM`);
      if (f.husb) buffer.push(`1 HUSB ${f.husb}`);
      if (f.wife) buffer.push(`1 WIFE ${f.wife}`);
      f.chil.forEach((c: string) => buffer.push(`1 CHIL ${c}`));
      buffer.push(`1 MARR`);
      buffer.push(`2 DATE ${f.marr}`);
  });

  buffer.push("0 TRLR");
  return buffer.join("\n");
};