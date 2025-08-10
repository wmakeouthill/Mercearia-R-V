import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PontoVenda } from './ponto-venda';

describe('PontoVenda', () => {
  let component: PontoVenda;
  let fixture: ComponentFixture<PontoVenda>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PontoVenda]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PontoVenda);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
