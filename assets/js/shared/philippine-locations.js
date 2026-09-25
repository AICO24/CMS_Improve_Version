/**
 * Philippine Locations Cascading Dataset & Hierarchy Controller
 * Batch 5 — Name & Location Validation
 *
 * Implements standard Philippine Geographic Code hierarchy:
 * Region -> Province -> City/Municipality -> District -> Barangay
 */
(function(window) {
    'use strict';

    const PHILIPPINE_LOCATIONS = {
        'NCR': {
            name: 'National Capital Region (NCR)',
            provinces: {
                'Metro Manila': {
                    name: 'Metro Manila',
                    cities: {
                        'Manila': {
                            name: 'City of Manila',
                            districts: {
                                'District 1': {
                                    name: 'District 1 (Tondo I)',
                                    barangays: ['Barangay 1', 'Barangay 20', 'Barangay 50', 'Barangay 100', 'Barangay 120', 'Barangay 146']
                                },
                                'District 2': {
                                    name: 'District 2 (Tondo II / Gagalangin)',
                                    barangays: ['Barangay 150', 'Barangay 175', 'Barangay 200', 'Barangay 230', 'Barangay 250']
                                },
                                'District 3': {
                                    name: 'District 3 (Binondo, Quiapo, San Nicolas, Sta. Cruz)',
                                    barangays: ['Barangay 281 (Binondo)', 'Barangay 306 (Quiapo)', 'Barangay 310 (Sta. Cruz)', 'Barangay 380 (San Nicolas)']
                                },
                                'District 4': {
                                    name: 'District 4 (Sampaloc)',
                                    barangays: ['Barangay 400', 'Barangay 450', 'Barangay 500', 'Barangay 550', 'Barangay 580']
                                },
                                'District 5': {
                                    name: 'District 5 (Ermita, Malate, Paco, Intramuros)',
                                    barangays: ['Barangay 659 (Intramuros)', 'Barangay 660 (Ermita)', 'Barangay 688 (Paco)', 'Barangay 701 (Malate)']
                                },
                                'District 6': {
                                    name: 'District 6 (Pandacan, Sta. Ana, San Miguel)',
                                    barangays: ['Barangay 830 (Pandacan)', 'Barangay 860 (Sta. Ana)', 'Barangay 890 (San Miguel)', 'Barangay 900 (Sta. Mesa)']
                                }
                            }
                        },
                        'Quezon City': {
                            name: 'Quezon City',
                            districts: {
                                'District 1': {
                                    name: 'District 1 (San Francisco del Monte, Project 6, La Loma)',
                                    barangays: ['Alicia', 'Bagong Pag-asa', 'Balingasa', 'Damayan', 'Mariblo', 'Project 6', 'San Antonio', 'Veterans Village']
                                },
                                'District 2': {
                                    name: 'District 2 (Batasan, Commonwealth, Payatas)',
                                    barangays: ['Bagong Silangan', 'Batasan Hills', 'Commonwealth', 'Holy Spirit', 'Payatas']
                                },
                                'District 3': {
                                    name: 'District 3 (Cubao, Loyola Heights, Quirino)',
                                    barangays: ['Amihan', 'Camp Aguinaldo', 'Claro', 'E. Rodriguez', 'Loyola Heights', 'Matandang Balara', 'Socorro (Cubao)']
                                },
                                'District 4': {
                                    name: 'District 4 (New Manila, Diliman, Kamuning)',
                                    barangays: ['Damayang Lagi', 'Kamuning', 'Kristong Hari', 'Mariana (New Manila)', 'Obrero', 'Roxas', 'Sacred Heart', 'U.P. Campus']
                                },
                                'District 5': {
                                    name: 'District 5 (Novaliches, Fairview)',
                                    barangays: ['Fairview', 'Greater Lagro', 'Gulod', 'Kaligayahan', 'Nagkaisang Nayon', 'North Fairview', 'Novaliches Proper', 'San Bartolome']
                                },
                                'District 6': {
                                    name: 'District 6 (Balintawak, Tandang Sora)',
                                    barangays: ['Apolonio Samson', 'Baesa', 'Culiat', 'Pasong Tamo', 'Sangandaan', 'Sauyo', 'Talipapa', 'Tandang Sora']
                                }
                            }
                        },
                        'Pasig': {
                            name: 'Pasig City',
                            districts: {
                                'District 1': {
                                    name: 'District 1 (West Pasig)',
                                    barangays: ['Bagong Ilog', 'Kapitolyo', 'Malinao', 'Oranbo', 'Pineda', 'San Antonio', 'San Nicolas', 'Sta. Cruz', 'Ugong']
                                },
                                'District 2': {
                                    name: 'District 2 (East Pasig)',
                                    barangays: ['Dela Paz', 'Kalawaan', 'Manggahan', 'Maybunga', 'Pinagbuhatan', 'Rosario', 'San Miguel', 'Santolan', 'Sta. Lucia']
                                }
                            }
                        },
                        'Makati': {
                            name: 'Makati City',
                            districts: {
                                'District 1': {
                                    name: 'District 1 (West Makati)',
                                    barangays: ['Bangkal', 'Bel-Air', 'Carmona', 'Dasmariñas', 'Forbes Park', 'Magallanes', 'Poblacion', 'San Antonio', 'San Lorenzo', 'Urdaneta']
                                },
                                'District 2': {
                                    name: 'District 2 (East Makati)',
                                    barangays: ['Cembo', 'Comembo', 'East Rembo', 'Guadalupe Nuevo', 'Guadalupe Viejo', 'Pembo', 'Pinagsama', 'Pitogo', 'West Rembo']
                                }
                            }
                        },
                        'Taguig': {
                            name: 'Taguig City',
                            districts: {
                                'District 1': {
                                    name: 'District 1',
                                    barangays: ['Bagumbayan', 'Bambang', 'Calzada', 'Hagonoy', 'Ibayo-Tipas', 'Ligid-Tipas', 'Lower Bicutan', 'New Lower Bicutan', 'Palingon', 'San Miguel', 'Santa Ana', 'Tuktukan', 'Ususan', 'Wawa']
                                },
                                'District 2': {
                                    name: 'District 2',
                                    barangays: ['Central Bicutan', 'Central Signal Village', 'Fort Bonifacio', 'Katuparan', 'Maharlika Village', 'North Daang Hari', 'North Signal Village', 'Pinagsama', 'South Daang Hari', 'South Signal Village', 'Tanyag', 'Upper Bicutan', 'Western Bicutan']
                                }
                            }
                        },
                        'Caloocan': {
                            name: 'Caloocan City',
                            districts: {
                                'District 1': {
                                    name: 'District 1 (North Caloocan)',
                                    barangays: ['Bagong Silang (Barangay 176)', 'Barangay 168 (Deparo)', 'Barangay 171 (Bagumbong)', 'Barangay 174 (Camarin)', 'Barangay 177']
                                },
                                'District 2': {
                                    name: 'District 2 (South Caloocan)',
                                    barangays: ['Barangay 1', 'Barangay 12', 'Barangay 36', 'Barangay 54', 'Barangay 80', 'Barangay 120']
                                },
                                'District 3': {
                                    name: 'District 3',
                                    barangays: ['Barangay 178 (Camarin)', 'Barangay 179 (Amparo)', 'Barangay 180', 'Barangay 185 (Malaria)']
                                }
                            }
                        },
                        'Mandaluyong': {
                            name: 'Mandaluyong City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Addition Hills', 'Barangka Drive', 'Barangka Ilaya', 'Highway Hills', 'Mauway', 'Plainview', 'Pleasant Hills', 'Wack-Wack Greenhills']
                                }
                            }
                        },
                        'San Juan': {
                            name: 'San Juan City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Addition Hills', 'Batis', 'Corazon de Jesus', 'Greenhills', 'Little Baguio', 'Maytunas', 'Pasadena', 'Pedro Cruz', 'West Crame']
                                }
                            }
                        },
                        'Marikina': {
                            name: 'Marikina City',
                            districts: {
                                'District 1': {
                                    name: 'District 1',
                                    barangays: ['Barangka', 'Calumpang', 'Industrial Valley Complex', 'Jesus Dela Peña', 'Malanday', 'San Roque', 'Santa Elena', 'Santo Niño']
                                },
                                'District 2': {
                                    name: 'District 2',
                                    barangays: ['Concepcion Uno', 'Concepcion Dos', 'Fortune', 'Marikina Heights', 'Nangka', 'Parang', 'Tumana']
                                }
                            }
                        },
                        'Parañaque': {
                            name: 'Parañaque City',
                            districts: {
                                'District 1': {
                                    name: 'District 1',
                                    barangays: ['Baclaran', 'Don Galo', 'La Huerta', 'San Dionisio', 'San Isidro', 'Sto. Niño', 'Tambo', 'Vitalez']
                                },
                                'District 2': {
                                    name: 'District 2',
                                    barangays: ['BF Homes', 'Don Bosco', 'Marcelo Green', 'Merville', 'Moonwalk', 'San Antonio', 'San Martin de Porres', 'Sun Valley']
                                }
                            }
                        },
                        'Pasay': {
                            name: 'Pasay City',
                            districts: {
                                'District 1': {
                                    name: 'District 1 (North/West)',
                                    barangays: ['Barangay 1', 'Barangay 20', 'Barangay 40', 'Barangay 76', 'Barangay 100']
                                },
                                'District 2': {
                                    name: 'District 2 (South/East)',
                                    barangays: ['Barangay 130', 'Barangay 150', 'Barangay 180', 'Barangay 190 (Malibay)', 'Barangay 201 (Kalayaan)']
                                }
                            }
                        },
                        'Las Piñas': {
                            name: 'Las Piñas City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Almanza Uno', 'Almanza Dos', 'BF International Village', 'Daniel Fajardo', 'Pamplona Uno', 'Pamplona Dos', 'Pilar', 'Pulang Lupa Uno', 'Talon Uno', 'Zapote']
                                }
                            }
                        },
                        'Muntinlupa': {
                            name: 'Muntinlupa City',
                            districts: {
                                'District 1': {
                                    name: 'District 1',
                                    barangays: ['Alabang', 'Bayanan', 'Poblacion', 'Putatan', 'Tunasan']
                                },
                                'District 2': {
                                    name: 'District 2',
                                    barangays: ['Ayala Alabang', 'Buli', 'Cupang', 'Sucat']
                                }
                            }
                        },
                        'Valenzuela': {
                            name: 'Valenzuela City',
                            districts: {
                                'District 1': {
                                    name: 'District 1',
                                    barangays: ['Arkong Bato', 'Balangkas', 'Bignay', 'Canumay West', 'Canumay East', 'Lawang Bato', 'Malanday', 'Poblacion', 'Punturin', 'Veinte Reales', 'Wawang Pulo']
                                },
                                'District 2': {
                                    name: 'District 2',
                                    barangays: ['Gen. T. de Leon', 'Karuhatan', 'Mapulang Lupa', 'Marulas', 'Maysan', 'Parada', 'Paso de Blas', 'Ugong']
                                }
                            }
                        },
                        'Malabon': {
                            name: 'Malabon City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Baritan', 'Catmon', 'Concepcion', 'Dampalit', 'Flores', 'Hulong Duhat', 'Ibaba', 'Longos', 'Niugan', 'Potrero', 'San Agustin', 'Tañong', 'Tonsuya']
                                }
                            }
                        },
                        'Navotas': {
                            name: 'Navotas City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Bagumbayan North', 'Bagumbayan South', 'Daanghari', 'Navotas East', 'Navotas West', 'North Bay Blvd South', 'San Jose', 'San Rafael Village', 'San Roque', 'Tangos North', 'Tangos South']
                                }
                            }
                        },
                        'Pateros': {
                            name: 'Municipality of Pateros',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Aguho', 'Magtanggol', 'Martirez del 96', 'Poblacion', 'San Pedro', 'San Roque', 'Santa Ana', 'Santo Rosario-Kanluran', 'Santo Rosario-Silangan', 'Tabacalera']
                                }
                            }
                        }
                    }
                }
            }
        },
        'REGION_4A': {
            name: 'Region IV-A (CALABARZON)',
            provinces: {
                'Rizal': {
                    name: 'Rizal',
                    cities: {
                        'Antipolo': {
                            name: 'Antipolo City',
                            districts: {
                                'District 1': {
                                    name: 'District 1',
                                    barangays: ['Bagong Nayon', 'Beverly Hills', 'De La Paz', 'Mayamot', 'Muntingdilaw', 'San Isidro', 'San Roque', 'Santa Cruz']
                                },
                                'District 2': {
                                    name: 'District 2',
                                    barangays: ['Calawis', 'Cupang', 'Dalig', 'Inarawan', 'Mambugan', 'San Jose', 'San Juan', 'San Luis']
                                }
                            }
                        },
                        'Angono': {
                            name: 'Angono',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Bagumbayan', 'Kalayaan', 'Mahabang Parang', 'Poblacion Ibaba', 'Poblacion Itaas', 'San Isidro', 'San Pedro', 'San Roque', 'San Vicente', 'Santo Niño']
                                }
                            }
                        },
                        'Cainta': {
                            name: 'Cainta',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['San Andres (Poblacion)', 'San Isidro', 'San Juan', 'San Roque', 'Santa Rosa', 'Santo Domingo', 'Santo Niño']
                                }
                            }
                        },
                        'Taytay': {
                            name: 'Taytay',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Dolores (Poblacion)', 'Muzon', 'San Isidro', 'San Juan', 'Santa Ana']
                                }
                            }
                        },
                        'Binangonan': {
                            name: 'Binangonan',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Bilibiran', 'Calumpang', 'Darangan', 'Layunan (Poblacion)', 'Libid (Poblacion)', 'Libis (Poblacion)', 'Limbon-limbon', 'Lunsad', 'Macamot', 'Mambog', 'Pag-asa', 'Pantok', 'Tagpos']
                                }
                            }
                        },
                        'San Mateo': {
                            name: 'San Mateo',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Ampid I', 'Ampid II', 'Banaba', 'Dulumbayan', 'Guitnang Bayan I', 'Guitnang Bayan II', 'Malanday', 'Maly', 'Pintong Bukawe', 'Santa Ana', 'Silangan']
                                }
                            }
                        },
                        'Rodriguez': {
                            name: 'Rodriguez (Montalban)',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Balite (Poblacion)', 'Burgos', 'Geromino', 'Macabud', 'Manggahan', 'Mascap', 'Puray', 'Rosario', 'San Isidro', 'San Jose', 'San Rafael']
                                }
                            }
                        }
                    }
                },
                'Cavite': {
                    name: 'Cavite',
                    cities: {
                        'Bacoor': {
                            name: 'Bacoor City',
                            districts: {
                                'District 1': {
                                    name: 'District 1',
                                    barangays: ['Alima', 'Aniban I', 'Daang Bukid', 'Digman', 'Dulong Bayan', 'Habay I', 'Kaingin', 'Mabolo I', 'Maliksi I', 'Niog I', 'Panapaan I', 'Real I', 'Salinas I', 'Talaba I', 'Zapote I']
                                },
                                'District 2': {
                                    name: 'District 2',
                                    barangays: ['Bayanan', 'Mambog I', 'Molino I', 'Molino II', 'Molino III', 'Molino IV', 'Queens Row Central', 'Queens Row East', 'Queens Row West', 'San Nicolas I']
                                }
                            }
                        },
                        'Imus': {
                            name: 'Imus City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Anabu I-A', 'Anabu II-A', 'Bucandala I', 'Carsadang Bago I', 'Malagasang I-A', 'Malagasang II-A', 'Medicion I-A', 'Palico I', 'Poblacion I-A', 'Tanzang Luma I']
                                }
                            }
                        },
                        'Dasmariñas': {
                            name: 'Dasmariñas City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Burol I', 'Burol Main', 'Fatima I', 'Langkaan I', 'Paliparan I', 'Paliparan III', 'Sabang', 'Salawag', 'Salitran I', 'Sampaloc I', 'San Agustin I', 'Zone I (Poblacion)']
                                }
                            }
                        },
                        'Tagaytay': {
                            name: 'Tagaytay City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Asisan', 'Bagong Tubig', 'Caloocan', 'Francisco', 'Iruhin Central', 'Kaybagal South', 'Mag-Asawang Ilat', 'Maharlika West', 'Mendez Crossing West', 'Silang Junction North', 'Sungay North', 'Tolentino East']
                                }
                            }
                        },
                        'General Trias': {
                            name: 'General Trias City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Arnaldo Pob.', 'Bacao I', 'Bagumbayan Pob.', 'Corregidor Pob.', 'Dulong Bayan Pob.', 'Manggahan', 'Navarro', 'Pasong Camachile I', 'San Francisco', 'Tejero']
                                }
                            }
                        }
                    }
                },
                'Laguna': {
                    name: 'Laguna',
                    cities: {
                        'Calamba': {
                            name: 'Calamba City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Bucal', 'Canlubang', 'Halang', 'Makiling', 'Milagrosa', 'Pansol', 'Parian', 'Real', 'Turbina']
                                }
                            }
                        },
                        'Santa Rosa': {
                            name: 'Santa Rosa City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Balibago', 'Caingin', 'Dila', 'Don Jose', 'Ibaba', 'Labas', 'Macabling', 'Malitlit', 'Pooc', 'Sinalhan', 'Tagapo']
                                }
                            }
                        },
                        'Biñan': {
                            name: 'Biñan City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Canlalay', 'Casile', 'De La Paz', 'Malaban', 'Mamplasan', 'Platero', 'Poblacion', 'San Antonio', 'San Francisco', 'San Vicente', 'Santo Tomas', 'Zapote']
                                }
                            }
                        },
                        'San Pedro': {
                            name: 'San Pedro City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Cuyab', 'Landayan', 'Narra', 'Pacita 1', 'Pacita 2', 'Poblacion', 'San Antonio', 'San Roque', 'San Vicente', 'United Bayanihan']
                                }
                            }
                        }
                    }
                },
                'Batangas': {
                    name: 'Batangas',
                    cities: {
                        'Batangas City': {
                            name: 'Batangas City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Alangilan', 'Balagtas', 'Bolbok', 'Calicanto', 'Kumintang Ibaba', 'Kumintang Ilaya', 'Pallocan West', 'Poblacion 1', 'Santa Rita Karsada']
                                }
                            }
                        },
                        'Lipa': {
                            name: 'Lipa City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Balintawak', 'Banaybanay', 'Dagatan', 'Inosloban', 'Lodlod', 'Marawoy', 'Mataas Na Lupa', 'Poblacion Barangay 1', 'Sabang', 'Tambo']
                                }
                            }
                        },
                        'Tanauan': {
                            name: 'Tanauan City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Darasa', 'Hidalgo', 'Natatas', 'Pantay Matanda', 'Poblacion 1', 'Sambat', 'Santor', 'Trapiche']
                                }
                            }
                        }
                    }
                },
                'Quezon': {
                    name: 'Quezon',
                    cities: {
                        'Lucena': {
                            name: 'Lucena City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Barangay 1 (Poblacion)', 'Cotta', 'Dalahican', 'Gulang-Gulang', 'Ibabang Dupay', 'Ibabang Iyam', 'Ilayang Dupay', 'Ilayang Iyam', 'Market View', 'Mayao Crossing']
                                }
                            }
                        }
                    }
                }
            }
        },
        'REGION_3': {
            name: 'Region III (Central Luzon)',
            provinces: {
                'Bulacan': {
                    name: 'Bulacan',
                    cities: {
                        'San Jose del Monte': {
                            name: 'City of San Jose del Monte',
                            districts: {
                                'District 1': {
                                    name: 'District 1',
                                    barangays: ['Ciudad Real', 'Dulumbayan', 'Gaya-gaya', 'Graceville', 'Gumaoc Central', 'Kaybanban', 'Muzon', 'Poblacion', 'Tungkong Mangga']
                                },
                                'District 2': {
                                    name: 'District 2',
                                    barangays: ['Assumption', 'Bagong Buhay I', 'Citrus', 'Fatima I', 'Minuyan Proper', 'San Martin I', 'Sapang Palay Proper', 'Santo Cristo']
                                }
                            }
                        },
                        'Malolos': {
                            name: 'Malolos City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Bulihan', 'Canalate', 'Catmon', 'Cofradia', 'Dakila', 'Guinhawa', 'Liang', 'Look 1st', 'Mojon', 'San Gabriel', 'San Vicente', 'Santo Rosario']
                                }
                            }
                        },
                        'Meycauayan': {
                            name: 'Meycauayan City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Bancal', 'Calvario', 'Camalig', 'Hulo', 'Iba', 'Langka', 'Malhacan', 'Pajo', 'Pandayan', 'Poblacion', 'Saluysoy', 'Tugatog']
                                }
                            }
                        },
                        'Marilao': {
                            name: 'Marilao',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Abangan Norte', 'Abangan Sur', 'Ibayo', 'Lias', 'Patubig', 'Poblacion I', 'Poblacion II', 'Prenza I', 'Saog', 'Tabing Ilog']
                                }
                            }
                        }
                    }
                },
                'Pampanga': {
                    name: 'Pampanga',
                    cities: {
                        'San Fernando': {
                            name: 'City of San Fernando',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Del Carmen', 'Del Pilar', 'Dolores', 'Magliman', 'Malpitic', 'Quebiawan', 'Saguin', 'San Agustin', 'San Jose', 'Sindalan', 'Telabastagan']
                                }
                            }
                        },
                        'Angeles': {
                            name: 'Angeles City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Anunas', 'Balibago', 'Capaya', 'Cutcut', 'Lourdes Sur', 'Malabanias', 'Pampang', 'Pulung Maragul', 'Santo Domingo', 'Santo Rosario']
                                }
                            }
                        }
                    }
                },
                'Bataan': {
                    name: 'Bataan',
                    cities: {
                        'Balanga': {
                            name: 'Balanga City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Bagumbayan', 'Camacho', 'Cataning', 'Central', 'Cupang North', 'Doña Francisca', 'Ibayo', 'Malabia', 'Poblacion', 'Puerto Rivas Ibaba', 'San Jose', 'Tenejero', 'Tortugas']
                                }
                            }
                        }
                    }
                },
                'Nueva Ecija': {
                    name: 'Nueva Ecija',
                    cities: {
                        'Cabanatuan': {
                            name: 'Cabanatuan City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Bantug Bulalo', 'Bantug Norte', 'Barrera', 'Bitas', 'D.S. Garcia', 'General Luna', 'Kapitan Pepe', 'Mabini Homesite', 'San Josef Sur', 'Sangitan', 'Zulueta']
                                }
                            }
                        }
                    }
                },
                'Tarlac': {
                    name: 'Tarlac',
                    cities: {
                        'Tarlac City': {
                            name: 'Tarlac City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Aguso', 'Binauganan', 'Cut-cut I', 'Fairlane', 'Matatalaib', 'San Manuel', 'San Nicolas', 'San Rafael', 'San Roque', 'San Vicente', 'Sepung Calzada', 'Tibag']
                                }
                            }
                        }
                    }
                },
                'Zambales': {
                    name: 'Zambales',
                    cities: {
                        'Olongapo': {
                            name: 'Olongapo City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Asinan', 'Banicain', 'Barretto', 'East Bajac-bajac', 'East Tapinac', 'Gordon Heights', 'Kalaklan', 'Mabayuan', 'New Cabalan', 'New Ilalim', 'New Kababae', 'New Kalalake', 'Old Cabalan', 'Pag-asa', 'Santa Rita', 'West Bajac-bajac', 'West Tapinac']
                                }
                            }
                        }
                    }
                }
            }
        },
        'REGION_1': {
            name: 'Region I (Ilocos Region)',
            provinces: {
                'Ilocos Norte': {
                    name: 'Ilocos Norte',
                    cities: {
                        'Laoag': {
                            name: 'Laoag City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Barangay 1 (San Lorenzo)', 'Barangay 10 (San Jose)', 'Barangay 23 (San Matias)', 'Nalbo', 'Navotas', 'Zamboanga']
                                }
                            }
                        }
                    }
                },
                'Pangasinan': {
                    name: 'Pangasinan',
                    cities: {
                        'Dagupan': {
                            name: 'Dagupan City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Bonuan Boquig', 'Bonuan Gueset', 'Lucao', 'Malued', 'Mayombo', 'Pantal', 'Poblacion Oeste', 'Tapuac']
                                }
                            }
                        }
                    }
                }
            }
        },
        'REGION_7': {
            name: 'Region VII (Central Visayas)',
            provinces: {
                'Cebu': {
                    name: 'Cebu',
                    cities: {
                        'Cebu City': {
                            name: 'Cebu City',
                            districts: {
                                'North District': {
                                    name: 'North District (1st District)',
                                    barangays: ['Apas', 'Banilad', 'Camputhaw', 'Carreta', 'Kasambagan', 'Lahug', 'Luz', 'Mabolo', 'Pari-an', 'Zapatera']
                                },
                                'South District': {
                                    name: 'South District (2nd District)',
                                    barangays: ['Basak San Nicolas', 'Guadalupe', 'Inayawan', 'Kinasang-an', 'Labangon', 'Mambaling', 'Pahina Central', 'Pardo', 'Punta Princesa', 'Tisa']
                                }
                            }
                        },
                        'Mandaue': {
                            name: 'Mandaue City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Bakilid', 'Banilad', 'Cabancalan', 'Centro', 'Guizo', 'Ibabao-Estancia', 'Maguikay', 'Paknaan', 'Subangdaku', 'Tipolo']
                                }
                            }
                        },
                        'Lapu-Lapu': {
                            name: 'Lapu-Lapu City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Basak', 'Gun-ob', 'Ibo', 'Mactan', 'Maribago', 'Marigondon', 'Poblacion', 'Punta Engaño', 'Pusok']
                                }
                            }
                        }
                    }
                },
                'Bohol': {
                    name: 'Bohol',
                    cities: {
                        'Tagbilaran': {
                            name: 'Tagbilaran City',
                            districts: {
                                'Lone District': {
                                    name: 'Lone District',
                                    barangays: ['Bool', 'Booy', 'Cabawan', 'Cogon', 'Dao', 'Dampas', 'Manga', 'Mansasa', 'Poblacion 1', 'Poblacion 2', 'San Isidro', 'Taloto', 'Tiptip', 'Ubujan']
                                }
                            }
                        }
                    }
                }
            }
        },
        'REGION_11': {
            name: 'Region XI (Davao Region)',
            provinces: {
                'Davao del Sur': {
                    name: 'Davao del Sur',
                    cities: {
                        'Davao City': {
                            name: 'Davao City',
                            districts: {
                                'District 1': {
                                    name: 'District 1 (Poblacion / Talomo)',
                                    barangays: ['Barangay 1-A', 'Barangay 20-B', 'Bucana', 'Matina Aplaya', 'Matina Crossing', 'Poblacion', 'Talomo Proper']
                                },
                                'District 2': {
                                    name: 'District 2 (Agdao / Buhangin)',
                                    barangays: ['Agdao Proper', 'Angliongto', 'Buhangin Proper', 'Cabantian', 'Indangan', 'Mandug', 'Sasa', 'Tigatto']
                                },
                                'District 3': {
                                    name: 'District 3 (Toril / Calinan)',
                                    barangays: ['Calinan Proper', 'Catalunan Grande', 'Catalunan Pequeño', 'Mintal', 'Toril Proper', 'Tugbok Proper']
                                }
                            }
                        }
                    }
                }
            }
        }
    };

    /**
     * Helper to populate a select element with key-value items
     */
    function populateSelect(selectEl, items, placeholder = '-- Select --', selectedValue = '') {
        if (!selectEl) return;
        selectEl.innerHTML = '';
        
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = placeholder;
        selectEl.appendChild(defaultOpt);

        if (Array.isArray(items)) {
            items.forEach(item => {
                const opt = document.createElement('option');
                opt.value = typeof item === 'string' ? item : item.key;
                opt.textContent = typeof item === 'string' ? item : item.name;
                if (opt.value === selectedValue) {
                    opt.selected = true;
                }
                selectEl.appendChild(opt);
            });
        } else if (items && typeof items === 'object') {
            Object.keys(items).forEach(key => {
                const opt = document.createElement('option');
                opt.value = key;
                opt.textContent = items[key].name || key;
                if (key === selectedValue) {
                    opt.selected = true;
                }
                selectEl.appendChild(opt);
            });
        }
    }

    /**
     * Initializes the standard cascading location hierarchy:
     * Region -> Province -> City/Municipality -> District -> Barangay
     *
     * Features:
     * - Child fields remain disabled until the direct parent is selected.
     * - Changing a parent clears and resets all dependent child selections.
     * - Populates only valid child locations for the selected parent.
     */
    function initHierarchy(config) {
        const {
            regionSelect,
            provinceSelect,
            citySelect,
            districtSelect,
            barangaySelect,
            streetInput,
            combinedAddressInput,
            onChange
        } = config;

        if (!regionSelect || !provinceSelect || !citySelect || !districtSelect || !barangaySelect) {
            console.warn('PhilippineLocations.initHierarchy: One or more required select elements are missing.');
            return null;
        }

        function syncCombinedAddress() {
            const regionKey = regionSelect.value;
            const provKey = provinceSelect.value;
            const cityKey = citySelect.value;
            const distKey = districtSelect.value;
            const brgyKey = barangaySelect.value;
            const street = (streetInput ? streetInput.value.trim() : '');

            const regionName = regionKey && PHILIPPINE_LOCATIONS[regionKey] ? PHILIPPINE_LOCATIONS[regionKey].name : '';
            const provName = regionKey && provKey && PHILIPPINE_LOCATIONS[regionKey]?.provinces[provKey]?.name || provKey;
            const cityName = regionKey && provKey && cityKey && PHILIPPINE_LOCATIONS[regionKey]?.provinces[provKey]?.cities[cityKey]?.name || cityKey;
            const distName = regionKey && provKey && cityKey && distKey && PHILIPPINE_LOCATIONS[regionKey]?.provinces[provKey]?.cities[cityKey]?.districts[distKey]?.name || distKey;
            const brgyName = brgyKey;

            const parts = [];
            if (street) parts.push(street);
            if (brgyName) parts.push(`Brgy. ${brgyName}`);
            if (distName) parts.push(distName);
            if (cityName) parts.push(cityName);
            if (provName && provName !== cityName && provName !== 'Metro Manila') parts.push(provName);
            if (regionName) parts.push(regionName);

            const combined = parts.join(', ');
            if (combinedAddressInput) {
                combinedAddressInput.value = combined;
            }

            if (typeof onChange === 'function') {
                onChange({
                    region: regionName,
                    regionKey,
                    province: provName,
                    provinceKey: provKey,
                    city: cityName,
                    cityKey,
                    district: distName,
                    districtKey: distKey,
                    barangay: brgyName,
                    street,
                    combinedAddress: combined,
                    isComplete: Boolean(regionKey && provKey && cityKey && distKey && brgyKey)
                });
            }

            return combined;
        }

        // 1. Initial State: Populate Regions, Disable Children
        populateSelect(regionSelect, PHILIPPINE_LOCATIONS, '-- Select Region --');
        regionSelect.disabled = false;

        provinceSelect.innerHTML = '<option value="">-- Select Province --</option>';
        provinceSelect.disabled = true;

        citySelect.innerHTML = '<option value="">-- Select City/Municipality --</option>';
        citySelect.disabled = true;

        districtSelect.innerHTML = '<option value="">-- Select District --</option>';
        districtSelect.disabled = true;

        barangaySelect.innerHTML = '<option value="">-- Select Barangay --</option>';
        barangaySelect.disabled = true;

        // 2. Region Change -> Resets Province, City, District, Barangay
        regionSelect.addEventListener('change', () => {
            const regKey = regionSelect.value;

            // Reset and disable all children
            provinceSelect.innerHTML = '<option value="">-- Select Province --</option>';
            provinceSelect.disabled = true;
            citySelect.innerHTML = '<option value="">-- Select City/Municipality --</option>';
            citySelect.disabled = true;
            districtSelect.innerHTML = '<option value="">-- Select District --</option>';
            districtSelect.disabled = true;
            barangaySelect.innerHTML = '<option value="">-- Select Barangay --</option>';
            barangaySelect.disabled = true;

            if (regKey && PHILIPPINE_LOCATIONS[regKey]) {
                const provinces = PHILIPPINE_LOCATIONS[regKey].provinces;
                populateSelect(provinceSelect, provinces, '-- Select Province --');
                provinceSelect.disabled = false;
            }

            syncCombinedAddress();
        });

        // 3. Province Change -> Resets City, District, Barangay
        provinceSelect.addEventListener('change', () => {
            const regKey = regionSelect.value;
            const provKey = provinceSelect.value;

            citySelect.innerHTML = '<option value="">-- Select City/Municipality --</option>';
            citySelect.disabled = true;
            districtSelect.innerHTML = '<option value="">-- Select District --</option>';
            districtSelect.disabled = true;
            barangaySelect.innerHTML = '<option value="">-- Select Barangay --</option>';
            barangaySelect.disabled = true;

            if (regKey && provKey && PHILIPPINE_LOCATIONS[regKey]?.provinces[provKey]) {
                const cities = PHILIPPINE_LOCATIONS[regKey].provinces[provKey].cities;
                populateSelect(citySelect, cities, '-- Select City/Municipality --');
                citySelect.disabled = false;
            }

            syncCombinedAddress();
        });

        // 4. City Change -> Resets District, Barangay
        citySelect.addEventListener('change', () => {
            const regKey = regionSelect.value;
            const provKey = provinceSelect.value;
            const cityKey = citySelect.value;

            districtSelect.innerHTML = '<option value="">-- Select District --</option>';
            districtSelect.disabled = true;
            barangaySelect.innerHTML = '<option value="">-- Select Barangay --</option>';
            barangaySelect.disabled = true;

            if (regKey && provKey && cityKey && PHILIPPINE_LOCATIONS[regKey]?.provinces[provKey]?.cities[cityKey]) {
                const districts = PHILIPPINE_LOCATIONS[regKey].provinces[provKey].cities[cityKey].districts;
                populateSelect(districtSelect, districts, '-- Select District --');
                districtSelect.disabled = false;
            }

            syncCombinedAddress();
        });

        // 5. District Change -> Resets Barangay
        districtSelect.addEventListener('change', () => {
            const regKey = regionSelect.value;
            const provKey = provinceSelect.value;
            const cityKey = citySelect.value;
            const distKey = districtSelect.value;

            barangaySelect.innerHTML = '<option value="">-- Select Barangay --</option>';
            barangaySelect.disabled = true;

            if (regKey && provKey && cityKey && distKey && PHILIPPINE_LOCATIONS[regKey]?.provinces[provKey]?.cities[cityKey]?.districts[distKey]) {
                const barangays = PHILIPPINE_LOCATIONS[regKey].provinces[provKey].cities[cityKey].districts[distKey].barangays;
                populateSelect(barangaySelect, barangays, '-- Select Barangay --');
                barangaySelect.disabled = false;
            }

            syncCombinedAddress();
        });

        // 6. Barangay & Street Change -> Syncs combined address
        barangaySelect.addEventListener('change', syncCombinedAddress);
        if (streetInput) {
            streetInput.addEventListener('input', syncCombinedAddress);
        }

        return {
            setValues: function(vals) {
                if (!vals) return;
                const { region, province, city, district, barangay, street } = vals;

                // Match Region
                if (region) {
                    let rKey = Object.keys(PHILIPPINE_LOCATIONS).find(k => k === region || PHILIPPINE_LOCATIONS[k].name.toLowerCase().includes(region.toLowerCase()));
                    if (rKey) {
                        regionSelect.value = rKey;
                        regionSelect.dispatchEvent(new Event('change'));

                        // Match Province
                        if (province) {
                            const provObj = PHILIPPINE_LOCATIONS[rKey]?.provinces;
                            let pKey = provObj ? Object.keys(provObj).find(k => k.toLowerCase() === province.toLowerCase() || provObj[k].name.toLowerCase().includes(province.toLowerCase())) : null;
                            if (pKey) {
                                provinceSelect.value = pKey;
                                provinceSelect.dispatchEvent(new Event('change'));

                                // Match City
                                if (city) {
                                    const cityObj = provObj[pKey]?.cities;
                                    let cKey = cityObj ? Object.keys(cityObj).find(k => k.toLowerCase() === city.toLowerCase() || cityObj[k].name.toLowerCase().includes(city.toLowerCase())) : null;
                                    if (cKey) {
                                        citySelect.value = cKey;
                                        citySelect.dispatchEvent(new Event('change'));

                                        // Match District
                                        if (district) {
                                            const distObj = cityObj[cKey]?.districts;
                                            let dKey = distObj ? Object.keys(distObj).find(k => k.toLowerCase() === district.toLowerCase() || distObj[k].name.toLowerCase().includes(district.toLowerCase())) : null;
                                            if (dKey) {
                                                districtSelect.value = dKey;
                                                districtSelect.dispatchEvent(new Event('change'));

                                                // Match Barangay
                                                if (barangay) {
                                                    const brgyList = distObj[dKey]?.barangays;
                                                    let bMatch = brgyList ? brgyList.find(b => b.toLowerCase() === barangay.toLowerCase() || b.toLowerCase().includes(barangay.toLowerCase())) : null;
                                                    if (bMatch) {
                                                        barangaySelect.value = bMatch;
                                                        barangaySelect.dispatchEvent(new Event('change'));
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if (streetInput && street) {
                    streetInput.value = street;
                }
                syncCombinedAddress();
            },
            reset: function() {
                regionSelect.value = '';
                regionSelect.dispatchEvent(new Event('change'));
                if (streetInput) streetInput.value = '';
                if (combinedAddressInput) combinedAddressInput.value = '';
            },
            getValues: function() {
                const regKey = regionSelect.value;
                const provKey = provinceSelect.value;
                const cityKey = citySelect.value;
                const distKey = districtSelect.value;
                const brgyKey = barangaySelect.value;
                const street = streetInput ? streetInput.value.trim() : '';

                return {
                    region: regKey && PHILIPPINE_LOCATIONS[regKey] ? PHILIPPINE_LOCATIONS[regKey].name : '',
                    regionKey: regKey,
                    province: regKey && provKey && PHILIPPINE_LOCATIONS[regKey]?.provinces[provKey]?.name || provKey,
                    provinceKey: provKey,
                    city: regKey && provKey && cityKey && PHILIPPINE_LOCATIONS[regKey]?.provinces[provKey]?.cities[cityKey]?.name || cityKey,
                    cityKey: cityKey,
                    district: regKey && provKey && cityKey && distKey && PHILIPPINE_LOCATIONS[regKey]?.provinces[provKey]?.cities[cityKey]?.districts[distKey]?.name || distKey,
                    districtKey: distKey,
                    barangay: brgyKey,
                    street: street,
                    combinedAddress: combinedAddressInput ? combinedAddressInput.value : syncCombinedAddress(),
                    isComplete: Boolean(regKey && provKey && cityKey && distKey && brgyKey)
                };
            }
        };
    }

    /**
     * Parses an existing combined address string into likely components
     */
    function parseAddress(addrString) {
        if (!addrString || typeof addrString !== 'string') {
            return { street: '', barangay: '', district: '', city: '', province: '', region: '' };
        }
        const parts = addrString.split(',').map(s => s.trim()).filter(Boolean);
        return {
            street: parts.length > 4 ? parts.slice(0, parts.length - 4).join(', ') : (parts[0] || ''),
            barangay: parts.find(p => p.toLowerCase().includes('brgy.') || p.toLowerCase().includes('barangay'))?.replace(/^(brgy\.?|barangay)\s*/i, '') || '',
            district: parts.find(p => p.toLowerCase().includes('district')) || '',
            city: parts.find(p => p.toLowerCase().includes('city') || p.toLowerCase().includes('manila') || p.toLowerCase().includes('pasig') || p.toLowerCase().includes('quezon')) || '',
            province: parts.find(p => p.toLowerCase().includes('rizal') || p.toLowerCase().includes('cavite') || p.toLowerCase().includes('laguna') || p.toLowerCase().includes('bulacan')) || '',
            region: parts.find(p => p.toLowerCase().includes('region') || p.toLowerCase().includes('ncr')) || ''
        };
    }

    window.PhilippineLocations = {
        data: PHILIPPINE_LOCATIONS,
        initHierarchy,
        parseAddress
    };

})(window);
